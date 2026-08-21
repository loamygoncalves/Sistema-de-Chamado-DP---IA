import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import TicketClosureReason, TicketPriority, TicketSource, TicketStatus


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
    closure_reason: TicketClosureReason | None


class TicketHistoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    actor_id: uuid.UUID | None
    actor_name: str | None = None
    action: str
    comment: str | None
    is_internal: bool
    created_at: datetime


class TicketAttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    uploaded_by: uuid.UUID
    created_at: datetime


class TicketDetail(TicketRead):
    history: list[TicketHistoryRead] = []
    attachments: list[TicketAttachmentRead] = []
    # Nomes resolvidos para a tela de atendimento — o analista precisa saber
    # com quem está falando e quem é o responsável, não só os UUIDs.
    requester_name: str | None = None
    requester_email: str | None = None
    assigned_to_name: str | None = None
    department_name: str | None = None


class TicketCommentCreate(BaseModel):
    comment: str
    # Nota interna (só analistas+ veem). Ignorado quando quem comenta é o
    # próprio solicitante — ver `POST /tickets/{id}/comments`.
    is_internal: bool = False
    # Muda o status junto com a mensagem, numa só ação (o analista responde e
    # o chamado já fica "aguardando colaborador"). Só analistas+; encerrar por
    # aqui não é permitido — encerrar exige motivo, via /close.
    new_status: TicketStatus | None = None


class TicketTransfer(BaseModel):
    department_id: uuid.UUID | None = None
    assigned_to: uuid.UUID | None = None
    reason: str | None = None


class TicketPriorityUpdate(BaseModel):
    priority: TicketPriority


class TicketStatusUpdate(BaseModel):
    status: TicketStatus
    comment: str | None = None


class TicketClose(BaseModel):
    """Motivo é obrigatório — é o que permite reportar depois quantos chamados
    foram encerrados por falta de interatividade em vez de resolvidos."""

    reason: TicketClosureReason
    # Vazio usa a mensagem padrão do motivo (ver CLOSURE_DEFAULT_MESSAGE).
    message: str | None = Field(default=None, max_length=4000)


class ClosureReasonOption(BaseModel):
    value: TicketClosureReason
    label: str
    default_message: str


class TicketRatingCreate(BaseModel):
    score: int
    comment: str | None = None
