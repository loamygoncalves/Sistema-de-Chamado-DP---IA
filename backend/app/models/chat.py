import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enum_types import pg_enum
from app.models.enums import ChatConversationStatus, ChatRole
from app.models.mixins import TimestampMixin, UUIDPKMixin


class ChatConversation(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "chat_conversations"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[ChatConversationStatus] = mapped_column(
        pg_enum(ChatConversationStatus, "chat_conversation_status"), default=ChatConversationStatus.ATIVA
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    messages = relationship("ChatMessage", back_populates="conversation", cascade="all, delete-orphan")


class ChatMessage(Base, UUIDPKMixin):
    __tablename__ = "chat_messages"

    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("chat_conversations.id"))
    role: Mapped[ChatRole] = mapped_column(pg_enum(ChatRole, "chat_role"))
    content: Mapped[str] = mapped_column(Text)
    confidence_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    sources: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    resulted_ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tickets.id"), nullable=True
    )
    # Resposta do colaborador ao "isso resolveu sua dúvida?" — perguntado após
    # TODA resposta da IA. Nulo = ainda não respondeu. É o sinal mais direto de
    # qualidade que existe: `false` marca exatamente quais respostas falharam,
    # independente da confiança que a IA achava que tinha.
    was_helpful: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()")

    conversation = relationship("ChatConversation", back_populates="messages")
