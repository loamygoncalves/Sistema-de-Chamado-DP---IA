from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enum_types import pg_enum
from app.models.enums import TicketPriority
from app.models.mixins import TimestampMixin, UUIDPKMixin


class Department(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "departments"

    name: Mapped[str] = mapped_column(String(120), unique=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    default_sla_hours: Mapped[int] = mapped_column(Integer, default=24)
    default_priority: Mapped[TicketPriority] = mapped_column(
        pg_enum(TicketPriority, "ticket_priority"), default=TicketPriority.MEDIA
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    users = relationship("User", back_populates="department")
    tickets = relationship("Ticket", back_populates="department")
