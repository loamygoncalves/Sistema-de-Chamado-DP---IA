import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ROLE_RANK, require_analyst, require_employee
from app.db.session import get_db
from app.models.department import Department
from app.models.enums import TicketStatus, UserRole
from app.models.ticket import Ticket, TicketAttachment
from app.models.user import User
from app.schemas.ticket import (
    TicketCommentCreate,
    TicketCreate,
    TicketDetail,
    TicketHistoryRead,
    TicketPriorityUpdate,
    TicketRatingCreate,
    TicketRead,
    TicketStatusUpdate,
    TicketTransfer,
)
from app.services import ticket_service
from app.services.audit_service import record_audit_log
from app.workers.tasks import generate_article_from_closed_ticket_task

router = APIRouter(prefix="/tickets", tags=["tickets"])


async def _get_ticket_or_404(db: AsyncSession, ticket_id: uuid.UUID) -> Ticket:
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chamado não encontrado")
    return ticket


def _is_staff(user: User) -> bool:
    return ROLE_RANK[user.role] >= ROLE_RANK[UserRole.ANALYST]


def _assert_can_view(ticket: Ticket, user: User) -> None:
    if not (ticket.requester_id == user.id or _is_staff(user)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sem acesso a este chamado")


@router.post("", response_model=TicketRead)
async def open_ticket(payload: TicketCreate, user: User = Depends(require_employee), db: AsyncSession = Depends(get_db)):
    ticket = await ticket_service.create_ticket(
        db,
        requester=user,
        department_id=payload.department_id,
        subject=payload.subject,
        description=payload.description,
        category=payload.category,
        subcategory=payload.subcategory,
        priority=payload.priority,
    )
    await record_audit_log(db, user_id=user.id, action="ticket_criado", entity="ticket", entity_id=str(ticket.id))
    await db.commit()
    await db.refresh(ticket)
    return ticket


@router.get("", response_model=list[TicketRead])
async def list_tickets(
    status_filter: TicketStatus | None = Query(None, alias="status"),
    department_id: uuid.UUID | None = None,
    mine: bool = False,
    user: User = Depends(require_employee),
    db: AsyncSession = Depends(get_db),
):
    query = select(Ticket)
    is_staff = _is_staff(user)
    if mine or not is_staff:
        query = query.where(Ticket.requester_id == user.id)
    if status_filter:
        query = query.where(Ticket.status == status_filter)
    if department_id:
        query = query.where(Ticket.department_id == department_id)
    query = query.order_by(Ticket.created_at.desc())
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{ticket_id}", response_model=TicketDetail)
async def get_ticket(ticket_id: uuid.UUID, user: User = Depends(require_employee), db: AsyncSession = Depends(get_db)):
    ticket = await _get_ticket_or_404(db, ticket_id)
    _assert_can_view(ticket, user)
    await db.refresh(ticket, attribute_names=["history"])

    history = sorted(ticket.history, key=lambda h: h.created_at)
    if not _is_staff(user):
        # O solicitante nunca vê as notas internas do time de atendimento.
        history = [h for h in history if not h.is_internal]

    requester = await db.get(User, ticket.requester_id)
    assignee = await db.get(User, ticket.assigned_to) if ticket.assigned_to else None
    department = await db.get(Department, ticket.department_id)

    return TicketDetail(
        **{column: getattr(ticket, column) for column in TicketRead.model_fields},
        history=[
            TicketHistoryRead(
                id=h.id,
                actor_id=h.actor_id,
                actor_name=h.actor.name if h.actor else None,
                action=h.action,
                comment=h.comment,
                is_internal=h.is_internal,
                created_at=h.created_at,
            )
            for h in history
        ],
        requester_name=requester.name if requester else None,
        requester_email=requester.email if requester else None,
        assigned_to_name=assignee.name if assignee else None,
        department_name=department.name if department else None,
    )


@router.post("/{ticket_id}/comments")
async def add_comment(
    ticket_id: uuid.UUID, payload: TicketCommentCreate, user: User = Depends(require_employee), db: AsyncSession = Depends(get_db)
):
    ticket = await _get_ticket_or_404(db, ticket_id)
    _assert_can_view(ticket, user)
    # Só analistas+ podem registrar nota interna — se o solicitante mandar a
    # flag, ela é ignorada em vez de criar uma nota que ele mesmo não veria.
    is_internal = payload.is_internal and _is_staff(user)
    history = await ticket_service.add_comment(db, ticket, user, payload.comment, is_internal=is_internal)
    await db.commit()
    return {"id": history.id, "is_internal": history.is_internal}


@router.post("/{ticket_id}/attachments")
async def add_attachment(
    ticket_id: uuid.UUID, file: UploadFile, user: User = Depends(require_employee), db: AsyncSession = Depends(get_db)
):
    ticket = await _get_ticket_or_404(db, ticket_id)
    _assert_can_view(ticket, user)
    content = await file.read()
    attachment = TicketAttachment(
        ticket_id=ticket.id,
        uploaded_by=user.id,
        filename=file.filename,
        content_type=file.content_type or "application/octet-stream",
        storage_path=f"tickets/{ticket.id}/{file.filename}",
        size_bytes=len(content),
    )
    db.add(attachment)
    await db.commit()
    return {"id": attachment.id, "filename": attachment.filename}


@router.post("/{ticket_id}/assume", response_model=TicketRead)
async def assume(ticket_id: uuid.UUID, analyst: User = Depends(require_analyst), db: AsyncSession = Depends(get_db)):
    ticket = await _get_ticket_or_404(db, ticket_id)
    ticket = await ticket_service.assume_ticket(db, ticket, analyst)
    await db.commit()
    await db.refresh(ticket)
    return ticket


@router.post("/{ticket_id}/transfer", response_model=TicketRead)
async def transfer(
    ticket_id: uuid.UUID, payload: TicketTransfer, analyst: User = Depends(require_analyst), db: AsyncSession = Depends(get_db)
):
    ticket = await _get_ticket_or_404(db, ticket_id)
    ticket = await ticket_service.transfer_ticket(
        db, ticket, analyst, department_id=payload.department_id, assigned_to=payload.assigned_to, reason=payload.reason
    )
    await db.commit()
    await db.refresh(ticket)
    return ticket


@router.patch("/{ticket_id}/priority", response_model=TicketRead)
async def update_priority(
    ticket_id: uuid.UUID, payload: TicketPriorityUpdate, analyst: User = Depends(require_analyst), db: AsyncSession = Depends(get_db)
):
    ticket = await _get_ticket_or_404(db, ticket_id)
    ticket = await ticket_service.change_priority(db, ticket, analyst, payload.priority)
    await db.commit()
    await db.refresh(ticket)
    return ticket


@router.patch("/{ticket_id}/status", response_model=TicketRead)
async def update_status(
    ticket_id: uuid.UUID, payload: TicketStatusUpdate, analyst: User = Depends(require_analyst), db: AsyncSession = Depends(get_db)
):
    ticket = await _get_ticket_or_404(db, ticket_id)
    ticket = await ticket_service.change_status(db, ticket, analyst, payload.status, payload.comment)
    await db.commit()
    await db.refresh(ticket)
    return ticket


@router.post("/{ticket_id}/close", response_model=TicketRead)
async def close_ticket(
    ticket_id: uuid.UUID, payload: TicketStatusUpdate, analyst: User = Depends(require_analyst), db: AsyncSession = Depends(get_db)
):
    ticket = await _get_ticket_or_404(db, ticket_id)
    ticket = await ticket_service.change_status(db, ticket, analyst, TicketStatus.ENCERRADO, payload.comment)
    await record_audit_log(db, user_id=analyst.id, action="ticket_encerrado", entity="ticket", entity_id=str(ticket.id))
    await db.commit()
    await db.refresh(ticket)

    generate_article_from_closed_ticket_task.delay(str(ticket.id))
    return ticket


@router.post("/{ticket_id}/rating")
async def rate_ticket(
    ticket_id: uuid.UUID, payload: TicketRatingCreate, user: User = Depends(require_employee), db: AsyncSession = Depends(get_db)
):
    from app.models.ticket import TicketRating

    ticket = await _get_ticket_or_404(db, ticket_id)
    if ticket.requester_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas o solicitante pode avaliar")
    if not 1 <= payload.score <= 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nota deve ser entre 1 e 5")

    rating = TicketRating(ticket_id=ticket.id, score=payload.score, comment=payload.comment)
    db.add(rating)
    await db.commit()
    return {"id": rating.id}
