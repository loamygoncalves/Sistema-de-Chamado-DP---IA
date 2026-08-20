from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_admin
from app.db.session import get_db
from app.models.user import User
from app.schemas.dashboard import AISettingsRead, AISettingsUpdate
from app.services.ai_settings_service import get_ai_settings, update_ai_settings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/ai", response_model=AISettingsRead)
async def read_ai_settings(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    values = await get_ai_settings(db)
    return AISettingsRead(**{k: v for k, v in values.items() if k in AISettingsRead.model_fields})


@router.patch("/ai", response_model=AISettingsRead)
async def patch_ai_settings(payload: AISettingsUpdate, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    values = await update_ai_settings(db, payload.model_dump(exclude_unset=True), admin.id)
    await db.commit()
    return AISettingsRead(**{k: v for k, v in values.items() if k in AISettingsRead.model_fields})
