from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_employee
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.user import UserRead

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/analysts", response_model=list[UserRead])
async def list_analysts(user: User = Depends(require_employee), db: AsyncSession = Depends(get_db)):
    """Lista os analistas do DP disponíveis para vincular a um chamado — usada
    pelo dropdown de atribuição na fila do analista."""
    result = await db.execute(
        select(User)
        .where(User.role == UserRole.ANALYST, User.is_active.is_(True))
        .order_by(User.name)
    )
    return result.scalars().all()
