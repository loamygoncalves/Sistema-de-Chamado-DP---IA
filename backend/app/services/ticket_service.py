import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.department import Department
from app.models.enums import TicketClosureReason, TicketPriority, TicketSource, TicketStatus
from app.models.ticket import Ticket, TicketHistory
from app.models.user import User
from app.services.ai_settings_service import get_ai_settings
from app.services.business_time import add_business_hours

SLA_HOURS_BY_PRIORITY_DEFAULT = {
    TicketPriority.BAIXA: 72,
    TicketPriority.MEDIA: 48,
    TicketPriority.ALTA: 24,
    TicketPriority.CRITICA: 4,
}

# Mensagem que o colaborador recebe no encerramento. Fica no backend (e é
# servida ao frontend por `GET /tickets/closure-reasons`) para não haver duas
# cópias do texto divergindo entre a tela do analista e a do colaborador.
CLOSURE_DEFAULT_MESSAGE = {
    TicketClosureReason.RESOLVIDO: (
        "Seu chamado foi resolvido. Agradecemos o contato! Se surgir qualquer nova dúvida, "
        "é só abrir um novo chamado que seguimos te ajudando."
    ),
    TicketClosureReason.SEM_INTERATIVIDADE: (
        "Estamos encerrando este chamado por falta de retorno. Agradecemos o contato! "
        "Se ainda precisar de ajuda com esse assunto, é só abrir um novo chamado."
    ),
    TicketClosureReason.DUPLICADO: (
        "Este chamado foi encerrado porque já existe outro em andamento sobre o mesmo "
        "assunto — o atendimento segue por lá. Agradecemos o contato!"
    ),
    TicketClosureReason.RESOLVIDO_PELO_COLABORADOR: "Encerrado pelo colaborador: assunto já resolvido.",
    TicketClosureReason.CANCELADO_PELO_COLABORADOR: "Encerrado pelo colaborador: não é mais necessário.",
}

CLOSURE_REASON_LABEL = {
    TicketClosureReason.RESOLVIDO: "Resolvido",
    TicketClosureReason.SEM_INTERATIVIDADE: "Encerrado por falta de interatividade",
    TicketClosureReason.DUPLICADO: "Duplicado de outro chamado",
    TicketClosureReason.RESOLVIDO_PELO_COLABORADOR: "Já resolvi, obrigado",
    TicketClosureReason.CANCELADO_PELO_COLABORADOR: "Não preciso mais",
}


class TicketAlreadyClosedError(Exception):
    pass


class StatusChangeNotAllowedError(Exception):
    pass


async def _next_ticket_number(db: AsyncSession) -> str:
    count = (await db.execute(select(func.count()).select_from(Ticket))).scalar_one()
    return f"BEEP-{count + 1:06d}"


async def _compute_sla_due_at(db: AsyncSession, department: Department, priority: TicketPriority) -> datetime:
    """Prazo de SLA em horas úteis — fins de semana e feriados nacionais não contam."""
    ai_settings = await get_ai_settings(db)
    sla_map = ai_settings.get("sla_by_priority") or {}
    hours = sla_map.get(priority.value) if isinstance(sla_map, dict) else None
    hours = hours or SLA_HOURS_BY_PRIORITY_DEFAULT[priority]
    hours = min(hours, department.default_sla_hours) if department.default_sla_hours else hours
    return add_business_hours(datetime.now(timezone.utc), hours)


async def create_ticket(
    db: AsyncSession,
    *,
    requester: User,
    department_id: uuid.UUID,
    subject: str,
    description: str,
    category: str | None = None,
    subcategory: str | None = None,
    priority: TicketPriority | None = None,
    source: TicketSource = TicketSource.MANUAL,
    origin_conversation_id: uuid.UUID | None = None,
) -> Ticket:
    department = await db.get(Department, department_id)
    if department is None:
        raise ValueError("Departamento (fila) não encontrado")

    # Sem prioridade explícita, a fila define a importância do assunto (ex.:
    # folha de pagamento nasce crítica; acesso ao portal ADP nasce baixa).
    if priority is None:
        priority = department.default_priority

    ticket = Ticket(
        ticket_number=await _next_ticket_number(db),
        requester_id=requester.id,
        matricula=requester.matricula,
        area=department.name if source != TicketSource.MANUAL else None,
        department_id=department_id,
        category=category,
        subcategory=subcategory,
        subject=subject,
        description=description,
        priority=priority,
        status=TicketStatus.NOVO,
        source=source,
        origin_conversation_id=origin_conversation_id,
        sla_due_at=await _compute_sla_due_at(db, department, priority),
    )
    db.add(ticket)
    await db.flush()

    db.add(TicketHistory(ticket_id=ticket.id, actor_id=requester.id, action="criado", comment=f"Origem: {source.value}"))
    await db.flush()
    return ticket


async def assume_ticket(db: AsyncSession, ticket: Ticket, analyst: User) -> Ticket:
    ticket.assigned_to = analyst.id
    ticket.status = TicketStatus.EM_ATENDIMENTO
    db.add(TicketHistory(ticket_id=ticket.id, actor_id=analyst.id, action="assumido"))
    await db.flush()
    return ticket


async def transfer_ticket(
    db: AsyncSession, ticket: Ticket, actor: User, *, department_id: uuid.UUID | None, assigned_to: uuid.UUID | None, reason: str | None
) -> Ticket:
    if department_id:
        ticket.department_id = department_id
        ticket.sla_due_at = await _compute_sla_due_at(db, await db.get(Department, department_id), ticket.priority)
    ticket.assigned_to = assigned_to
    ticket.status = TicketStatus.EM_TRIAGEM
    db.add(TicketHistory(ticket_id=ticket.id, actor_id=actor.id, action="transferido", comment=reason))
    await db.flush()
    return ticket


async def change_priority(db: AsyncSession, ticket: Ticket, actor: User, priority: TicketPriority) -> Ticket:
    ticket.priority = priority
    department = await db.get(Department, ticket.department_id)
    ticket.sla_due_at = await _compute_sla_due_at(db, department, priority)
    db.add(TicketHistory(ticket_id=ticket.id, actor_id=actor.id, action="prioridade_alterada", comment=priority.value))
    await db.flush()
    return ticket


async def change_status(db: AsyncSession, ticket: Ticket, actor: User, status: TicketStatus, comment: str | None) -> Ticket:
    """Muda o status, exceto para ENCERRADO — encerrar exige motivo, então
    passa obrigatoriamente por `close_ticket()`. Sem essa guarda, este
    endpoint seria um caminho alternativo para encerrar sem registrar motivo,
    e o relatório de "encerrado por falta de interatividade" ficaria furado."""
    if status == TicketStatus.ENCERRADO:
        raise StatusChangeNotAllowedError(
            "Para encerrar o chamado é obrigatório informar o motivo — use POST /tickets/{id}/close."
        )
    ticket.status = status
    db.add(TicketHistory(ticket_id=ticket.id, actor_id=actor.id, action="status_alterado", comment=comment or status.value))
    await db.flush()
    return ticket


async def close_ticket(
    db: AsyncSession,
    ticket: Ticket,
    actor: User,
    *,
    reason: TicketClosureReason,
    message: str | None = None,
) -> Ticket:
    """Encerra o chamado registrando o motivo (estruturado, para relatório) e
    uma mensagem de encerramento que o colaborador vê na conversa."""
    if ticket.status == TicketStatus.ENCERRADO:
        raise TicketAlreadyClosedError("Este chamado já está encerrado.")

    ticket.status = TicketStatus.ENCERRADO
    ticket.closed_at = datetime.now(timezone.utc)
    ticket.closure_reason = reason

    # A mensagem entra como fala pública para o colaborador ler no chamado; o
    # motivo entra como evento de fluxo, para a timeline e para o relatório.
    body = (message or "").strip() or CLOSURE_DEFAULT_MESSAGE[reason]
    db.add(
        TicketHistory(
            ticket_id=ticket.id, actor_id=actor.id, action="comentario", comment=body, is_internal=False
        )
    )
    db.add(
        TicketHistory(
            ticket_id=ticket.id,
            actor_id=actor.id,
            action="encerrado",
            comment=CLOSURE_REASON_LABEL[reason],
            extra_data={"closure_reason": reason.value},
        )
    )
    await db.flush()
    return ticket


async def add_comment(
    db: AsyncSession, ticket: Ticket, actor: User, comment: str, *, is_internal: bool = False
) -> TicketHistory:
    """`is_internal=True` marca uma nota interna do analista — ela nunca é
    devolvida ao colaborador solicitante (ver filtro em `GET /tickets/{id}`)."""
    history = TicketHistory(
        ticket_id=ticket.id,
        actor_id=actor.id,
        action="nota_interna" if is_internal else "comentario",
        comment=comment,
        is_internal=is_internal,
    )
    db.add(history)
    await db.flush()
    return history
