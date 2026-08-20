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
