import uuid

from pydantic import BaseModel, ConfigDict


class DepartmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    default_sla_hours: int
    is_active: bool


class DepartmentCreate(BaseModel):
    name: str
    slug: str
    default_sla_hours: int = 24
