"""Aprendizado contínuo: todo chamado encerrado vira conhecimento reutilizável.

Chamado ao final de `POST /tickets/{id}/close` (síncrono via Celery task, veja
`app/workers/tasks.py`), este serviço:
1. Monta o histórico de resolução do chamado.
2. Pede ao LLM um resumo + causa raiz + solução + rascunho de artigo.
3. Cria um `KnowledgeArticle` (source_type=generated) rastreável até o chamado.
4. Indexa o artigo no Qdrant, tornando-o disponível para o RAG imediatamente.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import KnowledgeSourceType
from app.models.knowledge import KnowledgeArticle
from app.models.ticket import Ticket, TicketHistory
from app.services.ai_providers import get_llm_provider
from app.services.ai_settings_service import get_ai_settings
from app.services.knowledge_service import index_article


async def generate_article_from_closed_ticket(db: AsyncSession, ticket_id) -> KnowledgeArticle | None:
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None:
        return None

    history_rows = (
        await db.execute(
            select(TicketHistory).where(TicketHistory.ticket_id == ticket.id).order_by(TicketHistory.created_at)
        )
    ).scalars().all()
    resolution_history = "\n".join(f"- [{h.action}] {h.comment or ''}" for h in history_rows)

    ai_settings = await get_ai_settings(db)
    provider = get_llm_provider(ai_settings["default_llm_provider"])
    summary_data = await provider.summarize_ticket(
        subject=ticket.subject, description=ticket.description, resolution_history=resolution_history
    )

    article = KnowledgeArticle(
        title=summary_data.get("article_title", f"Solução: {ticket.subject}")[:255],
        content=summary_data.get("article_content", summary_data.get("summary", "")),
        source_type=KnowledgeSourceType.GENERATED,
        department_id=ticket.department_id,
        tags=summary_data.get("tags") or [],
        created_from_ticket_id=ticket.id,
    )
    db.add(article)
    await db.flush()
    await index_article(db, article)
    return article
