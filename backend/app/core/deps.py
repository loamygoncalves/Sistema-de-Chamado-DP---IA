import uuid

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenError, decode_token
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.user import User

ROLE_RANK = {
    UserRole.EMPLOYEE: 0,
    UserRole.ANALYST: 1,
    UserRole.DEPARTMENT_LEAD: 2,
    UserRole.ADMIN: 3,
}


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token ausente")
    token = auth_header.removeprefix("Bearer ")
    try:
        payload = decode_token(token)
    except TokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido") from exc
    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tipo de token inválido")

    user_id = uuid.UUID(payload["sub"])
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário inválido")
    return user


def require_role(minimum_role: UserRole):
    async def _dependency(user: User = Depends(get_current_user)) -> User:
        if ROLE_RANK[user.role] < ROLE_RANK[minimum_role]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Permissão insuficiente")
        return user

    return _dependency


require_employee = require_role(UserRole.EMPLOYEE)
require_analyst = require_role(UserRole.ANALYST)
require_department_lead = require_role(UserRole.DEPARTMENT_LEAD)
require_admin = require_role(UserRole.ADMIN)
