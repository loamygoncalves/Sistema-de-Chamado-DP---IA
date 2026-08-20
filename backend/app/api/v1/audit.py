from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_admin
from app.db.session import get_db
from app.models.settings_model import AuditLog
from app.models.user import User

router = APIRouter(prefix="/audit-logs", tags=["audit"])


@router.get("")
async def list_audit_logs(
    entity: str | None = None,
    date_from: datetime | None = Query(None, alias="from"),
    date_to: datetime | None = Query(None, alias="to"),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    query = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(500)
    if entity:
        query = query.where(AuditLog.entity == entity)
    if date_from:
        query = query.where(AuditLog.created_at >= date_from)
    if date_to:
        query = query.where(AuditLog.created_at <= date_to)
    result = await db.execute(query)
    return [
        {
            "id": row.id,
            "user_id": row.user_id,
            "action": row.action,
            "entity": row.entity,
            "entity_id": row.entity_id,
            "created_at": row.created_at,
        }
        for row in result.scalars().all()
    ]
