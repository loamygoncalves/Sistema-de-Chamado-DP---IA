import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.department import Department
from app.models.enums import TicketPriority, TicketSource, TicketStatus
from app.models.ticket import Ticket, TicketHistory
from app.models.user import User
from app.services.ai_settings_service import get_ai_settings

SLA_HOURS_BY_PRIORITY_DEFAULT = {
    TicketPriority.BAIXA: 72,
    TicketPriority.MEDIA: 48,
    TicketPriority.ALTA: 24,
    TicketPriority.CRITICA: 4,
}


async def _next_ticket_number(db: AsyncSession) -> str:
    count = (await db.execute(select(func.count()).select_from(Ticket))).scalar_one()
    return f"BEEP-{count + 1:06d}"


async def _compute_sla_due_at(db: AsyncSession, department: Department, priority: TicketPriority) -> datetime:
    ai_settings = await get_ai_settings(db)
    sla_map = ai_settings.get("sla_by_priority") or {}
    hours = sla_map.get(priority.value) if isinstance(sla_map, dict) else None
    hours = hours or SLA_HOURS_BY_PRIORITY_DEFAULT[priority]
    hours = min(hours, department.default_sla_hours) if department.default_sla_hours else hours
    return datetime.now(timezone.utc) + timedelta(hours=hours)


async def create_ticket(
    db: AsyncSession,
    *,
    requester: User,
    department_id: uuid.UUID,
    subject: str,
    description: str,
    category: str | None = None,
    subcategory: str | None = None,
    priority: TicketPriority = TicketPriority.MEDIA,
    source: TicketSource = TicketSource.MANUAL,
    origin_conversation_id: uuid.UUID | None = None,
) -> Ticket:
    department = await db.get(Department, department_id)
    if department is None:
        raise ValueError("Departamento (fila) não encontrado")

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
    ticket.status = status
    if status == TicketStatus.ENCERRADO:
        ticket.closed_at = datetime.now(timezone.utc)
    db.add(TicketHistory(ticket_id=ticket.id, actor_id=actor.id, action="status_alterado", comment=comment or status.value))
    await db.flush()
    return ticket


async def add_comment(db: AsyncSession, ticket: Ticket, actor: User, comment: str) -> TicketHistory:
    history = TicketHistory(ticket_id=ticket.id, actor_id=actor.id, action="comentario", comment=comment)
    db.add(history)
    await db.flush()
    return history
