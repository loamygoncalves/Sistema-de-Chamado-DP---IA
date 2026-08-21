import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_employee
from app.db.session import get_db
from app.models.chat import ChatConversation, ChatMessage
from app.models.enums import ChatRole
from app.models.user import User
from app.schemas.chat import (
    ConversationCreate,
    ConversationRead,
    MessageCreate,
    MessageFeedback,
    MessageRead,
    MessageResponse,
    SourceRef,
    TicketRef,
)
from app.services.chat_service import (
    ConversationClosedError,
    ask_question,
    close_conversation,
    open_ticket_from_suggestion,
)

router = APIRouter(prefix="/chat", tags=["chat"])


async def _get_owned_conversation(db: AsyncSession, conversation_id: uuid.UUID, user: User) -> ChatConversation:
    conversation = await db.get(ChatConversation, conversation_id)
    if conversation is None or conversation.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada")
    return conversation


@router.post("/conversations", response_model=ConversationRead)
async def create_conversation(
    payload: ConversationCreate, user: User = Depends(require_employee), db: AsyncSession = Depends(get_db)
):
    conversation = ChatConversation(user_id=user.id, title=payload.title)
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation


@router.get("/conversations", response_model=list[ConversationRead])
async def list_conversations(user: User = Depends(require_employee), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChatConversation).where(ChatConversation.user_id == user.id).order_by(ChatConversation.created_at.desc())
    )
    return result.scalars().all()


@router.get("/conversations/{conversation_id}", response_model=list[MessageRead])
async def get_conversation_messages(
    conversation_id: uuid.UUID, user: User = Depends(require_employee), db: AsyncSession = Depends(get_db)
):
    await _get_owned_conversation(db, conversation_id, user)
    result = await db.execute(
        select(ChatMessage).where(ChatMessage.conversation_id == conversation_id).order_by(ChatMessage.created_at)
    )
    return result.scalars().all()


@router.post("/conversations/{conversation_id}/close", response_model=ConversationRead)
async def close(conversation_id: uuid.UUID, user: User = Depends(require_employee), db: AsyncSession = Depends(get_db)):
    """Encerra a conversa — a IA esquece o histórico dela. Uma nova conversa
    (`POST /chat/conversations`) começa sem nenhuma memória desta."""
    conversation = await _get_owned_conversation(db, conversation_id, user)
    conversation = await close_conversation(db, conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation


def _ticket_ref(ticket) -> TicketRef:
    return TicketRef(id=ticket.id, ticket_number=ticket.ticket_number, priority=ticket.priority, sla_due_at=ticket.sla_due_at)


@router.post("/conversations/{conversation_id}/messages", response_model=MessageResponse)
async def post_message(
    conversation_id: uuid.UUID,
    payload: MessageCreate,
    user: User = Depends(require_employee),
    db: AsyncSession = Depends(get_db),
):
    conversation = await _get_owned_conversation(db, conversation_id, user)
    try:
        result = await ask_question(db, user=user, conversation=conversation, question=payload.content)
    except ConversationClosedError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    await db.commit()

    ticket = result["ticket"]
    return MessageResponse(
        message_id=result["message_id"],
        answer=result["answer"],
        confidence_score=result["confidence_score"],
        decision=result["decision"],
        sources=[SourceRef(**s) for s in result["sources"]],
        ticket=_ticket_ref(ticket) if ticket else None,
    )


async def _get_owned_message(db: AsyncSession, conversation_id: uuid.UUID, message_id: uuid.UUID) -> ChatMessage:
    message = await db.get(ChatMessage, message_id)
    if message is None or message.conversation_id != conversation_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mensagem não encontrada")
    return message


@router.post("/conversations/{conversation_id}/messages/{message_id}/feedback", response_model=MessageRead)
async def rate_answer(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: MessageFeedback,
    user: User = Depends(require_employee),
    db: AsyncSession = Depends(get_db),
):
    """Registra se a resposta da IA ajudou. A pergunta é feita após TODA
    resposta — inclusive as de alta confiança, que antes não pediam retorno
    nenhum. Um `was_helpful=false` é o gatilho para oferecer o chamado ao DP."""
    await _get_owned_conversation(db, conversation_id, user)
    message = await _get_owned_message(db, conversation_id, message_id)
    if message.role != ChatRole.ASSISTANT:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Só é possível avaliar respostas da IA")

    message.was_helpful = payload.was_helpful
    await db.commit()
    await db.refresh(message)
    return message


@router.post("/conversations/{conversation_id}/messages/{message_id}/open-ticket", response_model=TicketRef)
async def open_ticket(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    department_id: uuid.UUID,
    user: User = Depends(require_employee),
    db: AsyncSession = Depends(get_db),
):
    await _get_owned_conversation(db, conversation_id, user)
    message = await _get_owned_message(db, conversation_id, message_id)
    if message.resulted_ticket_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Esta mensagem já gerou um chamado")

    ticket = await open_ticket_from_suggestion(db, user=user, message=message, department_id=department_id)
    await db.commit()
    return _ticket_ref(ticket)
