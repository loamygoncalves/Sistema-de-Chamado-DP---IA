from datetime import datetime

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatMessage
from app.models.department import Department
from app.models.enums import ChatRole, TicketStatus
from app.models.ticket import Ticket, TicketRating

AVERAGE_HUMAN_HANDLING_COST_REAIS = 65.0  # custo médio estimado de um atendimento humano


async def get_summary(db: AsyncSession, date_from: datetime | None, date_to: datetime | None) -> dict:
    ticket_filters = []
    message_filters = [ChatMessage.role == ChatRole.ASSISTANT]
    if date_from:
        ticket_filters.append(Ticket.created_at >= date_from)
        message_filters.append(ChatMessage.created_at >= date_from)
    if date_to:
        ticket_filters.append(Ticket.created_at <= date_to)
        message_filters.append(ChatMessage.created_at <= date_to)

    total_atendimentos = (
        await db.execute(select(func.count()).select_from(ChatMessage).where(*message_filters))
    ).scalar_one()

    total_chamados = (await db.execute(select(func.count()).select_from(Ticket).where(*ticket_filters))).scalar_one()

    auto_answers = (
        await db.execute(
            select(func.count()).select_from(ChatMessage).where(*message_filters, ChatMessage.resulted_ticket_id.is_(None))
        )
    ).scalar_one()

    taxa_resolucao_ia = (auto_answers / total_atendimentos) if total_atendimentos else 0.0
    taxa_abertura_chamado = 1 - taxa_resolucao_ia if total_atendimentos else 0.0

    sla_row = (
        await db.execute(
            select(
                func.avg(func.extract("epoch", Ticket.sla_due_at - Ticket.created_at) / 3600.0),
                func.avg(
                    case(
                        (Ticket.closed_at.isnot(None), func.extract("epoch", Ticket.closed_at - Ticket.created_at) / 3600.0)
                    )
                ),
            ).where(*ticket_filters)
        )
    ).one()
    sla_medio_horas = float(sla_row[0] or 0.0)
    tempo_medio_resolucao_horas = float(sla_row[1] or 0.0)

    nps_row = (await db.execute(select(func.avg(TicketRating.score)))).scalar_one()
    nps_interno = float((nps_row or 0) * 20)  # normaliza escala 1-5 para 0-100

    tickets_avoided = auto_answers
    economia_estimada_reais = float(tickets_avoided) * AVERAGE_HUMAN_HANDLING_COST_REAIS

    return {
        "total_atendimentos": total_atendimentos,
        "total_chamados": total_chamados,
        "taxa_resolucao_ia": round(taxa_resolucao_ia, 4),
        "taxa_abertura_chamado": round(taxa_abertura_chamado, 4),
        "sla_medio_horas": round(sla_medio_horas, 2),
        "tempo_medio_resolucao_horas": round(tempo_medio_resolucao_horas, 2),
        "nps_interno": round(nps_interno, 1),
        "economia_estimada_reais": round(economia_estimada_reais, 2),
    }


async def get_by_department(db: AsyncSession) -> list[dict]:
    rows = (
        await db.execute(
            select(
                Department.name,
                func.count(Ticket.id),
                func.count(Ticket.id).filter(Ticket.status == TicketStatus.ENCERRADO),
            )
            .join(Ticket, Ticket.department_id == Department.id, isouter=True)
            .group_by(Department.name)
            .order_by(Department.name)
        )
    ).all()
    result = []
    for name, total, resolved in rows:
        total = total or 0
        resolved = resolved or 0
        result.append(
            {
                "department": name,
                "total_chamados": total,
                "resolvidos": resolved,
                "taxa_resolucao": round(resolved / total, 4) if total else 0.0,
            }
        )
    return result


async def get_source_breakdown(db: AsyncSession) -> dict:
    rows = (await db.execute(select(Ticket.source, func.count(Ticket.id)).group_by(Ticket.source))).all()
    return {source.value: count for source, count in rows}
