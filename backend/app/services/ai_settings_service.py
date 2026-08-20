from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.settings_model import AISetting

DEFAULTS = {
    "confidence_threshold_auto": settings.CONFIDENCE_THRESHOLD_AUTO,
    "confidence_threshold_suggest": settings.CONFIDENCE_THRESHOLD_SUGGEST,
    "default_llm_provider": settings.DEFAULT_LLM_PROVIDER,
    "default_llm_model": settings.ANTHROPIC_MODEL,
    "rag_top_k": settings.RAG_TOP_K,
}


async def get_ai_settings(db: AsyncSession) -> dict:
    result = await db.execute(select(AISetting))
    rows = {row.key: row.value for row in result.scalars().all()}
    merged = dict(DEFAULTS)
    for key, wrapped in rows.items():
        if key in merged and isinstance(wrapped, dict) and "value" in wrapped:
            merged[key] = wrapped["value"]
    return merged


async def update_ai_settings(db: AsyncSession, updates: dict, updated_by) -> dict:
    for key, value in updates.items():
        if value is None:
            continue
        result = await db.execute(select(AISetting).where(AISetting.key == key))
        row = result.scalar_one_or_none()
        if row is None:
            row = AISetting(key=key, value={"value": value})
            db.add(row)
        else:
            row.value = {"value": value}
            row.updated_by = updated_by
    await db.flush()
    return await get_ai_settings(db)
