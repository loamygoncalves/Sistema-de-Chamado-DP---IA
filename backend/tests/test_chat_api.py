from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.services.ai_providers import LLMResult

pytestmark = pytest.mark.asyncio


def _mock_hit(source_id: str, title: str, text: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=source_id, payload={"source_id": source_id, "source_type": "faq", "title": title, "text": text}
    )


async def test_high_confidence_auto_answers_without_opening_ticket(employee_client: AsyncClient):
    with (
        patch("app.services.chat_service.embedding_service.embed_one", new=AsyncMock(return_value=[0.1] * 8)),
        patch(
            "app.services.chat_service.vector_store.search",
            new=AsyncMock(return_value=[_mock_hit("faq-1", "Banco de horas", "As horas são compensadas em 6 meses.")]),
        ),
        patch("app.services.chat_service.get_llm_provider") as get_provider,
    ):
        provider = AsyncMock()
        provider.generate.return_value = LLMResult(
            answer="Seu banco de horas é compensado em até 6 meses.", confidence=0.95, used_source_ids=["faq-1"]
        )
        get_provider.return_value = provider

        conv = await employee_client.post("/api/v1/chat/conversations", json={})
        conversation_id = conv.json()["id"]

        response = await employee_client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            json={"content": "Como funciona meu banco de horas?"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["decision"] == "auto_answer"
        assert data["ticket"] is None
        assert data["sources"][0]["title"] == "Banco de horas"


async def test_low_confidence_does_not_open_ticket_without_confirmation(employee_client: AsyncClient):
    with (
        patch("app.services.chat_service.embedding_service.embed_one", new=AsyncMock(return_value=[0.1] * 8)),
        patch("app.services.chat_service.vector_store.search", new=AsyncMock(return_value=[])),
        patch("app.services.chat_service.get_llm_provider") as get_provider,
    ):
        provider = AsyncMock()
        get_provider.return_value = provider

        conv = await employee_client.post("/api/v1/chat/conversations", json={})
        conversation_id = conv.json()["id"]

        response = await employee_client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            json={"content": "Pergunta muito específica sem nada na base de conhecimento"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["decision"] == "auto_ticket"
        # A IA nunca abre o chamado sozinha, mesmo com confiança muito baixa —
        # só a confirmação explícita via open-ticket cria o chamado.
        assert data["ticket"] is None


async def test_low_confidence_ticket_opens_only_after_explicit_confirmation(
    employee_client: AsyncClient, department
):
    with (
        patch("app.services.chat_service.embedding_service.embed_one", new=AsyncMock(return_value=[0.1] * 8)),
        patch("app.services.chat_service.vector_store.search", new=AsyncMock(return_value=[])),
        patch("app.services.chat_service.get_llm_provider") as get_provider,
    ):
        get_provider.return_value = AsyncMock()

        conv = await employee_client.post("/api/v1/chat/conversations", json={})
        conversation_id = conv.json()["id"]

        response = await employee_client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            json={"content": "Pergunta muito específica sem nada na base de conhecimento"},
        )
        message_id = response.json()["message_id"]

        confirm = await employee_client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages/{message_id}/open-ticket"
            f"?department_id={department.id}"
        )
        assert confirm.status_code == 200
        assert confirm.json()["ticket_number"].startswith("BEEP-")


async def test_medium_confidence_suggests_ticket(employee_client: AsyncClient):
    with (
        patch("app.services.chat_service.embedding_service.embed_one", new=AsyncMock(return_value=[0.1] * 8)),
        patch(
            "app.services.chat_service.vector_store.search",
            new=AsyncMock(return_value=[_mock_hit("art-1", "Política parcial", "Trecho pouco específico.")]),
        ),
        patch("app.services.chat_service.get_llm_provider") as get_provider,
    ):
        provider = AsyncMock()
        provider.generate.return_value = LLMResult(
            answer="Não tenho certeza completa, mas pode ser assim.", confidence=0.70, used_source_ids=["art-1"]
        )
        get_provider.return_value = provider

        conv = await employee_client.post("/api/v1/chat/conversations", json={})
        conversation_id = conv.json()["id"]

        response = await employee_client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            json={"content": "Dúvida intermediária"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["decision"] == "suggest_ticket"
        assert data["ticket"] is None


async def test_second_message_sends_prior_turn_as_history(employee_client: AsyncClient):
    with (
        patch("app.services.chat_service.embedding_service.embed_one", new=AsyncMock(return_value=[0.1] * 8)),
        patch(
            "app.services.chat_service.vector_store.search",
            new=AsyncMock(return_value=[_mock_hit("faq-1", "Banco de horas", "As horas são compensadas em 6 meses.")]),
        ),
        patch("app.services.chat_service.get_llm_provider") as get_provider,
    ):
        provider = AsyncMock()
        provider.generate.return_value = LLMResult(
            answer="Seu banco de horas é compensado em até 6 meses.", confidence=0.95, used_source_ids=["faq-1"]
        )
        get_provider.return_value = provider

        conv = await employee_client.post("/api/v1/chat/conversations", json={})
        conversation_id = conv.json()["id"]

        await employee_client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            json={"content": "Como funciona meu banco de horas?"},
        )
        # A primeira pergunta não tem histórico anterior (conversa nova).
        assert provider.generate.call_args_list[0].kwargs["history"] == []

        await employee_client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            json={"content": "E se eu estiver de plantão?"},
        )
        # A segunda pergunta já carrega a pergunta e a resposta anteriores —
        # é isso que dá memória de verdade à conversa.
        history = provider.generate.call_args_list[1].kwargs["history"]
        assert history == [
            {"role": "user", "content": "Como funciona meu banco de horas?"},
            {"role": "assistant", "content": "Seu banco de horas é compensado em até 6 meses."},
        ]


async def test_closed_conversation_rejects_new_messages(employee_client: AsyncClient):
    conv = await employee_client.post("/api/v1/chat/conversations", json={})
    conversation_id = conv.json()["id"]

    closed = await employee_client.post(f"/api/v1/chat/conversations/{conversation_id}/close")
    assert closed.status_code == 200
    assert closed.json()["status"] == "encerrada"
    assert closed.json()["closed_at"] is not None

    response = await employee_client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "Ainda dá para perguntar aqui?"},
    )
    assert response.status_code == 409

    # Uma nova conversa não tem nenhuma relação com a encerrada — memória zerada.
    new_conv = await employee_client.post("/api/v1/chat/conversations", json={})
    assert new_conv.status_code == 200
    assert new_conv.json()["status"] == "ativa"
    assert new_conv.json()["id"] != conversation_id


async def _ask_one(client: AsyncClient, question: str, *, answer: str, confidence: float) -> dict:
    """Faz uma pergunta com o RAG e o LLM mockados, devolvendo a resposta da API."""
    with (
        patch("app.services.chat_service.embedding_service.embed_one", new=AsyncMock(return_value=[0.1] * 8)),
        patch(
            "app.services.chat_service.vector_store.search",
            new=AsyncMock(return_value=[_mock_hit("faq-1", "Banco de horas", "Compensadas em 6 meses.")]),
        ),
        patch("app.services.chat_service.get_llm_provider") as get_provider,
    ):
        provider = AsyncMock()
        provider.generate.return_value = LLMResult(answer=answer, confidence=confidence, used_source_ids=["faq-1"])
        get_provider.return_value = provider

        conv = await client.post("/api/v1/chat/conversations", json={})
        conversation_id = conv.json()["id"]
        response = await client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages", json={"content": question}
        )
        return {"conversation_id": conversation_id, **response.json()}


async def test_high_confidence_answer_starts_without_feedback_and_accepts_it(employee_client: AsyncClient):
    # Mesmo com 95% de confiança a pergunta "isso resolveu?" é feita — antes,
    # respostas de alta confiança não pediam retorno nenhum.
    asked = await _ask_one(
        employee_client, "Como funciona meu banco de horas?", answer="Compensado em 6 meses.", confidence=0.95
    )
    assert asked["decision"] == "auto_answer"

    messages = await employee_client.get(f"/api/v1/chat/conversations/{asked['conversation_id']}")
    assistant = [m for m in messages.json() if m["role"] == "assistant"][0]
    assert assistant["was_helpful"] is None  # ainda não respondeu

    feedback = await employee_client.post(
        f"/api/v1/chat/conversations/{asked['conversation_id']}/messages/{asked['message_id']}/feedback",
        json={"was_helpful": True},
    )
    assert feedback.status_code == 200
    assert feedback.json()["was_helpful"] is True


async def test_negative_feedback_is_recorded_and_ticket_can_then_be_opened(
    employee_client: AsyncClient, department
):
    asked = await _ask_one(
        employee_client, "Como funciona meu banco de horas?", answer="Compensado em 6 meses.", confidence=0.95
    )

    negative = await employee_client.post(
        f"/api/v1/chat/conversations/{asked['conversation_id']}/messages/{asked['message_id']}/feedback",
        json={"was_helpful": False},
    )
    assert negative.status_code == 200
    assert negative.json()["was_helpful"] is False

    # Dizer que não ajudou é o que leva à oferta de chamado — mas o chamado
    # em si continua só nascendo da confirmação explícita.
    ticket = await employee_client.post(
        f"/api/v1/chat/conversations/{asked['conversation_id']}/messages/{asked['message_id']}"
        f"/open-ticket?department_id={department.id}"
    )
    assert ticket.status_code == 200
    assert ticket.json()["ticket_number"].startswith("BEEP-")


async def test_feedback_can_be_changed_and_is_persisted(employee_client: AsyncClient):
    asked = await _ask_one(
        employee_client, "Como solicitar férias?", answer="Solicite pelo gestor.", confidence=0.9
    )
    base = f"/api/v1/chat/conversations/{asked['conversation_id']}/messages/{asked['message_id']}/feedback"

    await employee_client.post(base, json={"was_helpful": True})
    changed = await employee_client.post(base, json={"was_helpful": False})
    assert changed.json()["was_helpful"] is False

    messages = await employee_client.get(f"/api/v1/chat/conversations/{asked['conversation_id']}")
    assistant = [m for m in messages.json() if m["role"] == "assistant"][0]
    assert assistant["was_helpful"] is False


async def test_cannot_rate_the_users_own_question(employee_client: AsyncClient):
    asked = await _ask_one(
        employee_client, "Qual a política de home office?", answer="Híbrido, 2 dias.", confidence=0.9
    )
    messages = await employee_client.get(f"/api/v1/chat/conversations/{asked['conversation_id']}")
    user_message = [m for m in messages.json() if m["role"] == "user"][0]

    response = await employee_client.post(
        f"/api/v1/chat/conversations/{asked['conversation_id']}/messages/{user_message['id']}/feedback",
        json={"was_helpful": True},
    )
    assert response.status_code == 400


async def test_feedback_on_someone_elses_conversation_is_rejected(
    client_as, employee_user, analyst_user
):
    async with client_as(employee_user) as employee:
        asked = await _ask_one(employee, "Dúvida qualquer", answer="Resposta.", confidence=0.9)

    async with client_as(analyst_user) as outro:
        response = await outro.post(
            f"/api/v1/chat/conversations/{asked['conversation_id']}/messages/{asked['message_id']}/feedback",
            json={"was_helpful": True},
        )
    assert response.status_code == 404
