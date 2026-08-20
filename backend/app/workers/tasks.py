import asyncio
import logging

from app.db.session import AsyncSessionLocal
from app.services import drive_sync_service
from app.services.learning_service import generate_article_from_closed_ticket
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="learning.generate_article_from_closed_ticket")
def generate_article_from_closed_ticket_task(ticket_id: str) -> str | None:
    async def _run():
        async with AsyncSessionLocal() as db:
            article = await generate_article_from_closed_ticket(db, ticket_id)
            await db.commit()
            return str(article.id) if article else None

    return asyncio.run(_run())


@celery_app.task(name="ingestion.ingest_document")
def ingest_document_task(document_id: str) -> str:
    """Placeholder para reprocessamento assíncrono de documentos grandes.

    A ingestão síncrona já ocorre em `POST /knowledge/documents`; esta task
    existe para reindexações em lote disparadas por job agendado.
    """
    return document_id


@celery_app.task(name="knowledge.sync_google_drive_folder")
def sync_google_drive_folder_task() -> dict:
    """Sincroniza periodicamente a pasta do Google Drive configurada em
    `GOOGLE_DRIVE_FOLDER_ID` com a base de conhecimento. Agendada via
    `celery_app.conf.beat_schedule` quando `GOOGLE_DRIVE_SYNC_ENABLED=true`;
    também pode ser disparada sob demanda pelo endpoint
    `POST /knowledge/documents/sync-drive`."""

    async def _run():
        async with AsyncSessionLocal() as db:
            result = await drive_sync_service.sync_folder(db)
            await db.commit()
            return result

    result = asyncio.run(_run())
    if result.errors:
        logger.warning("Sincronização com Google Drive concluída com erros: %s", result.errors)
    return {
        "created": result.created,
        "updated": result.updated,
        "skipped_unchanged": result.skipped_unchanged,
        "skipped_unsupported": result.skipped_unsupported,
        "errors": result.errors,
    }
