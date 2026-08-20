"""Orquestração do fluxo principal: pergunta → RAG → decisão por confiança.

Regras de negócio (parametrizáveis via `ai_settings`):
- confidence > confidence_threshold_auto            -> responde automaticamente.
- confidence_threshold_suggest <= confidence <= auto -> responde e sugere chamado.
- confidence < confidence_threshold_suggest          -> abre chamado automaticamente.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatConversation, ChatMessage
from app.models.enums import ChatDecision, ChatRole, TicketPriority, TicketSource
from app.models.user import User
from app.services.ai_providers import get_llm_provider
from app.services.ai_settings_service import get_ai_settings
from app.services.embeddings import embedding_service
from app.services.ticket_service import create_ticket
from app.services.vector_store import vector_store

FALLBACK_DEPARTMENT_SLUG = "declaracoes"


def _decide(confidence: float, threshold_auto: float, threshold_suggest: float) -> ChatDecision:
    if confidence > threshold_auto:
        return ChatDecision.AUTO_ANSWER
    if confidence >= threshold_suggest:
        return ChatDecision.SUGGEST_TICKET
    return ChatDecision.AUTO_TICKET


async def ask_question(
    db: AsyncSession, *, user: User, conversation: ChatConversation, question: str
) -> dict:
    ai_settings = await get_ai_settings(db)
    top_k = int(ai_settings["rag_top_k"])
    threshold_auto = float(ai_settings["confidence_threshold_auto"])
    threshold_suggest = float(ai_settings["confidence_threshold_suggest"])

    department_id = str(user.department_id) if user.department_id else None
    query_vector = await embedding_service.embed_one(question)
    hits = await vector_store.search(vector=query_vector, top_k=top_k, department_id=department_id)

    context_blocks = [
        {
            "id": hit.payload.get("source_id", str(hit.id)),
            "type": hit.payload.get("source_type", "artigo"),
            "title": hit.payload.get("title", ""),
            "text": hit.payload.get("text", ""),
        }
        for hit in hits
    ]

    provider = get_llm_provider(ai_settings["default_llm_provider"])

    if not context_blocks:
        answer, confidence, used_ids = (
            "Não encontrei informação suficiente na base de conhecimento para responder com segurança.",
            0.0,
            [],
        )
    else:
        result = await provider.generate(question=question, context_blocks=context_blocks)
        answer, confidence, used_ids = result.answer, result.confidence, result.used_source_ids

    decision = _decide(confidence, threshold_auto, threshold_suggest)
    matched_blocks = [b for b in context_blocks if b["id"] in used_ids] or context_blocks[:3]
    used_sources = [
        {"id": b["id"], "type": b["type"], "title": b["title"], "excerpt": b["text"][:300]} for b in matched_blocks
    ]

    db.add(ChatMessage(conversation_id=conversation.id, role=ChatRole.USER, content=question))

    ticket = None
    if decision == ChatDecision.AUTO_TICKET:
        dept_id = user.department_id
        from sqlalchemy import select

        from app.models.department import Department

        if dept_id is None:
            dept = (
                await db.execute(select(Department).where(Department.slug == FALLBACK_DEPARTMENT_SLUG))
            ).scalar_one_or_none()
            dept_id = dept.id if dept else None
        if dept_id:
            ticket = await create_ticket(
                db,
                requester=user,
                department_id=dept_id,
                subject=question[:255],
                description=(
                    f"Chamado aberto automaticamente pela IA (confiança {confidence:.0%}).\n\n"
                    f"Pergunta original: {question}\n\nMelhor resposta parcial da IA: {answer}"
                ),
                priority=TicketPriority.MEDIA,
                source=TicketSource.IA_AUTOMATICO,
                origin_conversation_id=conversation.id,
            )

    assistant_message = ChatMessage(
        conversation_id=conversation.id,
        role=ChatRole.ASSISTANT,
        content=answer,
        confidence_score=round(confidence * 100, 2),
        sources=used_sources,
        resulted_ticket_id=ticket.id if ticket else None,
    )
    db.add(assistant_message)
    await db.flush()

    return {
        "message_id": assistant_message.id,
        "answer": answer,
        "confidence_score": confidence,
        "decision": decision,
        "sources": used_sources,
        "ticket": ticket,
    }


async def open_ticket_from_suggestion(
    db: AsyncSession, *, user: User, message: ChatMessage, department_id: uuid.UUID
) -> "Ticket":  # noqa: F821
    conversation_id = message.conversation_id
    question_msg_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation_id, ChatMessage.role == ChatRole.USER)
        .order_by(ChatMessage.created_at.desc())
        .limit(1)
    )
    question_msg = question_msg_result.scalar_one_or_none()
    subject = question_msg.content[:255] if question_msg else message.content[:255]

    ticket = await create_ticket(
        db,
        requester=user,
        department_id=department_id,
        subject=subject,
        description=f"Pergunta: {subject}\n\nResposta da IA (sugerida abertura de chamado):\n{message.content}",
        source=TicketSource.IA_SUGERIDO,
        origin_conversation_id=conversation_id,
    )
    message.resulted_ticket_id = ticket.id
    await db.flush()
    return ticket
