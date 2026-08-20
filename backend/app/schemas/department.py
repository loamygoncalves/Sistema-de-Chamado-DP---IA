import uuid

from pydantic import BaseModel, ConfigDict

from app.models.enums import TicketPriority


class DepartmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    default_sla_hours: int
    default_priority: TicketPriority
    is_active: bool


class DepartmentCreate(BaseModel):
    name: str
    slug: str
    default_sla_hours: int = 24
    default_priority: TicketPriority = TicketPriority.MEDIA
