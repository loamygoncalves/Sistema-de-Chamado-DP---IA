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


async def test_low_confidence_opens_ticket_automatically(employee_client: AsyncClient):
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
        assert data["ticket"] is not None
        assert data["ticket"]["ticket_number"].startswith("BEEP-")


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
