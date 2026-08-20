import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import ChatConversationStatus, ChatDecision, ChatRole, TicketPriority


class ConversationCreate(BaseModel):
    title: str | None = None


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str | None
    status: ChatConversationStatus
    closed_at: datetime | None
    created_at: datetime


class MessageCreate(BaseModel):
    content: str


class SourceRef(BaseModel):
    type: str
    id: str
    title: str
    excerpt: str


class TicketRef(BaseModel):
    id: uuid.UUID
    ticket_number: str
    priority: TicketPriority
    sla_due_at: datetime | None


class MessageResponse(BaseModel):
    message_id: uuid.UUID
    answer: str
    confidence_score: float
    decision: ChatDecision
    sources: list[SourceRef]
    ticket: TicketRef | None = None


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: ChatRole
    content: str
    confidence_score: Decimal | None
    sources: list | None
    created_at: datetime
