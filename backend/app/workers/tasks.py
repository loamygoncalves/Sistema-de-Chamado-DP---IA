import asyncio

from app.db.session import AsyncSessionLocal
from app.services import email_service
from app.services.learning_service import generate_article_from_closed_ticket
from app.workers.celery_app import celery_app


@celery_app.task(name="learning.generate_article_from_closed_ticket")
def generate_article_from_closed_ticket_task(ticket_id: str) -> str | None:
    async def _run():
        async with AsyncSessionLocal() as db:
            article = await generate_article_from_closed_ticket(db, ticket_id)
            await db.commit()
            return str(article.id) if article else None

    return asyncio.run(_run())


@celery_app.task(name="notifications.send_ticket_email")
def send_ticket_email_task(ticket_id: str, event: str) -> bool:
    """event: "aberto" | "respondido" | "finalizado". Sem
    EMAIL_NOTIFICATIONS_ENABLED/SMTP configurados, é um no-op (retorna False)
    — nunca impede a ação do chamado que disparou o evento."""

    async def _run():
        async with AsyncSessionLocal() as db:
            return await email_service.notify_ticket_event(db, ticket_id, event)

    return asyncio.run(_run())


@celery_app.task(name="ingestion.ingest_document")
def ingest_document_task(document_id: str) -> str:
    """Placeholder para reprocessamento assíncrono de documentos grandes.

    A ingestão síncrona já ocorre em `POST /knowledge/documents`; esta task
    existe para reindexações em lote disparadas por job agendado.
    """
    return document_id
