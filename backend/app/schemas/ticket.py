import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import TicketPriority, TicketSource, TicketStatus


class TicketCreate(BaseModel):
    department_id: uuid.UUID
    category: str | None = None
    subcategory: str | None = None
    subject: str
    description: str
    # Sem valor, a prioridade padrão da fila é usada (ex.: folha de pagamento
    # nasce crítica). O colaborador ainda pode indicar explicitamente.
    priority: TicketPriority | None = None


class TicketRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_number: str
    requester_id: uuid.UUID
    matricula: str | None
    area: str | None
    department_id: uuid.UUID
    category: str | None
    subcategory: str | None
    subject: str
    description: str
    priority: TicketPriority
    status: TicketStatus
    sla_due_at: datetime | None
    assigned_to: uuid.UUID | None
    source: TicketSource
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None


class TicketHistoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    comment: str | None
    created_at: datetime


class TicketDetail(TicketRead):
    history: list[TicketHistoryRead] = []


class TicketCommentCreate(BaseModel):
    comment: str


class TicketTransfer(BaseModel):
    department_id: uuid.UUID | None = None
    assigned_to: uuid.UUID | None = None
    reason: str | None = None


class TicketPriorityUpdate(BaseModel):
    priority: TicketPriority


class TicketStatusUpdate(BaseModel):
    status: TicketStatus
    comment: str | None = None


class TicketRatingCreate(BaseModel):
    score: int
    comment: str | None = None
