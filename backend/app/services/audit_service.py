import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings_model import AuditLog


async def record_audit_log(
    db: AsyncSession,
    *,
    user_id: uuid.UUID | None,
    action: str,
    entity: str,
    entity_id: str | None = None,
    ip_address: str | None = None,
    extra_data: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            entity=entity,
            entity_id=entity_id,
            ip_address=ip_address,
            extra_data=extra_data,
        )
    )
    await db.flush()
