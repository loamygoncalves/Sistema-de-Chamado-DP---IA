"""Orquestração do fluxo principal: pergunta → RAG → decisão por confiança.

Regras de negócio (parametrizáveis via `ai_settings`):
- confidence > confidence_threshold_auto            -> responde automaticamente.
- confidence_threshold_suggest <= confidence <= auto -> responde e sugere chamado.
- confidence < confidence_threshold_suggest          -> IA não tem uma resposta segura.

Importante: em nenhum dos dois últimos casos um chamado é criado sozinho. A IA
só sugere — quem decide se o chamado deve ser aberto é sempre o colaborador,
via confirmação explícita (`open_ticket_from_suggestion`). Isso evita abrir um
chamado a cada pergunta que a IA não consegue responder com plena confiança.
"""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.chat import ChatConversation, ChatMessage
from app.models.enums import ChatConversationStatus, ChatDecision, ChatRole, TicketSource
from app.models.user import User
from app.services import local_folder_sync_service
from app.services.ai_providers import get_llm_provider
from app.services.ai_settings_service import get_ai_settings
from app.services.embeddings import embedding_service
from app.services.local_folder_sync_service import LocalSyncNotConfigured
from app.services.ticket_service import create_ticket
from app.services.vector_store import vector_store

logger = logging.getLogger(__name__)


class ConversationClosedError(Exception):
    pass


def _decide(confidence: float, threshold_auto: float, threshold_suggest: float) -> ChatDecision:
    if confidence > threshold_auto:
        return ChatDecision.AUTO_ANSWER
    if confidence >= threshold_suggest:
        return ChatDecision.SUGGEST_TICKET
    return ChatDecision.AUTO_TICKET


async def _recent_history(db: AsyncSession, conversation_id: uuid.UUID) -> list[dict]:
    """Últimas mensagens da conversa (usuário+IA), em ordem cronológica, para
    dar memória de verdade ao LLM — sem isso cada pergunta é respondida como
    se fosse a primeira, e perguntas de acompanhamento ("e esse valor muda
    se eu...") não fazem sentido para a IA. Limitada a
    `CHAT_HISTORY_MAX_MESSAGES` para não inflar o custo por chamada."""
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation_id, ChatMessage.role != ChatRole.SYSTEM)
        .order_by(ChatMessage.created_at.desc())
        .limit(settings.CHAT_HISTORY_MAX_MESSAGES)
    )
    recent = list(reversed(result.scalars().all()))
    return [{"role": m.role.value, "content": m.content} for m in recent]


async def ask_question(
    db: AsyncSession, *, user: User, conversation: ChatConversation, question: str
) -> dict:
    if conversation.status == ChatConversationStatus.ENCERRADA:
        raise ConversationClosedError("Esta conversa foi encerrada. Inicie uma nova para continuar.")

    # Lê a pasta local/de rede antes de responder, para que qualquer arquivo
    # novo ou alterado desde a última pergunta já entre na base de
    # conhecimento. Arquivos sem mudança são pulados (só um stat() por
    # arquivo) — o custo de embedding só é pago por conteúdo de fato novo.
    # Sem LOCAL_KNOWLEDGE_FOLDER configurado, isso é um no-op silencioso.
    try:
        await local_folder_sync_service.sync_folder(db)
    except LocalSyncNotConfigured:
        pass
    except Exception:  # noqa: BLE001 — uma falha de sincronização não pode impedir a resposta
        logger.warning("Falha ao sincronizar a pasta de conhecimento local", exc_info=True)

    ai_settings = await get_ai_settings(db)
    top_k = int(ai_settings["rag_top_k"])
    threshold_auto = float(ai_settings["confidence_threshold_auto"])
    threshold_suggest = float(ai_settings["confidence_threshold_suggest"])

    history = await _recent_history(db, conversation.id)

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
        result = await provider.generate(question=question, context_blocks=context_blocks, history=history)
        answer, confidence, used_ids = result.answer, result.confidence, result.used_source_ids

    decision = _decide(confidence, threshold_auto, threshold_suggest)
    matched_blocks = [b for b in context_blocks if b["id"] in used_ids] or context_blocks[:3]
    used_sources = [
        {"id": b["id"], "type": b["type"], "title": b["title"], "excerpt": b["text"][:300]} for b in matched_blocks
    ]

    # created_at é fixado explicitamente (em vez de confiar no default do
    # servidor): `now()` do Postgres devolve o mesmo instante para todo INSERT
    # dentro da mesma transação, então a pergunta e a resposta desta mesma
    # rodada empatariam no timestamp — e _recent_history() depende da ordem
    # cronológica para reconstruir a memória da conversa corretamente.
    db.add(
        ChatMessage(
            conversation_id=conversation.id,
            role=ChatRole.USER,
            content=question,
            created_at=datetime.now(timezone.utc),
        )
    )

    # Nenhum chamado é criado aqui — tanto em SUGGEST_TICKET quanto em
    # AUTO_TICKET, a resposta apenas convida o colaborador a confirmar a
    # abertura via `POST .../messages/{id}/open-ticket`.
    assistant_message = ChatMessage(
        conversation_id=conversation.id,
        role=ChatRole.ASSISTANT,
        content=answer,
        confidence_score=round(confidence * 100, 2),
        sources=used_sources,
        created_at=datetime.now(timezone.utc),
    )
    db.add(assistant_message)
    await db.flush()

    return {
        "message_id": assistant_message.id,
        "answer": answer,
        "confidence_score": confidence,
        "decision": decision,
        "sources": used_sources,
        "ticket": None,
    }


def _ticket_source_for_confidence(confidence_score, threshold_suggest: float) -> TicketSource:
    """Classifica a origem do chamado para fins de relatório (dashboard de
    economia/automação) a partir da confiança que a IA teve na resposta —
    mesmo que, em ambos os casos, a abertura em si dependa de confirmação."""
    if confidence_score is not None and float(confidence_score) / 100 >= threshold_suggest:
        return TicketSource.IA_SUGERIDO
    return TicketSource.IA_AUTOMATICO


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

    ai_settings = await get_ai_settings(db)
    source = _ticket_source_for_confidence(message.confidence_score, float(ai_settings["confidence_threshold_suggest"]))

    ticket = await create_ticket(
        db,
        requester=user,
        department_id=department_id,
        subject=subject,
        description=f"Pergunta: {subject}\n\nResposta da IA:\n{message.content}",
        source=source,
        origin_conversation_id=conversation_id,
    )
    message.resulted_ticket_id = ticket.id
    await db.flush()
    return ticket


async def close_conversation(db: AsyncSession, conversation: ChatConversation) -> ChatConversation:
    """Encerra a conversa — a IA 'esquece' o histórico dela: uma nova conversa
    (novo `conversation_id`) começa sem nenhuma memória desta. A conversa
    encerrada continua consultável (histórico), só não aceita novas mensagens."""
    conversation.status = ChatConversationStatus.ENCERRADA
    conversation.closed_at = datetime.now(timezone.utc)
    await db.flush()
    return conversation
