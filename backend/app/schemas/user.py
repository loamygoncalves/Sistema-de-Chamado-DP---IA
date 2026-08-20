import uuid

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.enums import UserRole


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: EmailStr
    matricula: str | None
    department_id: uuid.UUID | None
    role: UserRole
    is_active: bool
