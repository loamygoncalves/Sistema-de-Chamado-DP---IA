import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.department import Department
from app.models.enums import UserRole
from app.models.ticket import Ticket, TicketAttachment
from app.models.user import User

pytestmark = pytest.mark.asyncio


async def _open_ticket(client: AsyncClient, department: Department, subject: str = "Assunto de teste") -> dict:
    response = await client.post(
        "/api/v1/tickets",
        json={"department_id": str(department.id), "subject": subject, "description": "Descrição de teste."},
    )
    assert response.status_code == 200
    return response.json()


# ---------- busca e filtro por analista responsável ----------


async def test_list_tickets_filters_by_assigned_to(analyst_client: AsyncClient, analyst_user: User, department, db_session):
    other_analyst = User(
        name="Outro Analista",
        email="outro.analista@beepsaude.com.br",
        matricula="20002",
        role=UserRole.ANALYST,
        identity_provider_sub=str(uuid.uuid4()),
    )
    db_session.add(other_analyst)
    await db_session.commit()
    await db_session.refresh(other_analyst)

    mine = await _open_ticket(analyst_client, department, "Chamado que vou assumir")
    await analyst_client.post(f"/api/v1/tickets/{mine['id']}/assume")

    others = await _open_ticket(analyst_client, department, "Chamado de outra pessoa")
    ticket = await db_session.get(Ticket, uuid.UUID(others["id"]))
    ticket.assigned_to = other_analyst.id
    await db_session.commit()

    response = await analyst_client.get(f"/api/v1/tickets?assigned_to={analyst_user.id}")
    assert response.status_code == 200
    numbers = [t["ticket_number"] for t in response.json()]
    assert mine["ticket_number"] in numbers
    assert others["ticket_number"] not in numbers


async def test_list_tickets_search_by_protocol_matricula_and_subject(
    client_as, employee_user: User, analyst_user: User, department
):
    # `employee_client`+`analyst_client` juntos no mesmo teste resolveriam os
    # DOIS para o último usuário sobrescrito (app.dependency_overrides é
    # global) — por isso um bloco `client_as` por ator, nunca os dois fixtures
    # prontos ao mesmo tempo.
    async with client_as(employee_user) as employee_client:
        # Aberto pelo colaborador (dono da matrícula buscada) — a busca em si
        # é feita pelo analista, que enxerga todos os chamados, não só os seus.
        ticket = await _open_ticket(employee_client, department, "Dúvida bem específica sobre décimo terceiro")

    async with client_as(analyst_user) as analyst_client:
        by_protocol = await analyst_client.get(f"/api/v1/tickets?q={ticket['ticket_number']}")
        assert ticket["ticket_number"] in [t["ticket_number"] for t in by_protocol.json()]

        by_matricula = await analyst_client.get(f"/api/v1/tickets?q={employee_user.matricula}")
        assert ticket["ticket_number"] in [t["ticket_number"] for t in by_matricula.json()]

        by_subject = await analyst_client.get("/api/v1/tickets?q=décimo terceiro")
        assert ticket["ticket_number"] in [t["ticket_number"] for t in by_subject.json()]

        by_nothing = await analyst_client.get("/api/v1/tickets?q=assunto-que-nao-existe-em-lugar-nenhum")
        assert by_nothing.json() == []


# ---------- transferência (gap de cobertura — endpoint já existia) ----------


async def test_analyst_can_transfer_ticket_to_another_analyst(analyst_client: AsyncClient, department, db_session):
    other_analyst = User(
        name="Segunda Analista",
        email="segunda.analista@beepsaude.com.br",
        matricula="20003",
        role=UserRole.ANALYST,
        identity_provider_sub=str(uuid.uuid4()),
    )
    db_session.add(other_analyst)
    await db_session.commit()
    await db_session.refresh(other_analyst)

    ticket = await _open_ticket(analyst_client, department)
    await analyst_client.post(f"/api/v1/tickets/{ticket['id']}/assume")

    response = await analyst_client.post(
        f"/api/v1/tickets/{ticket['id']}/transfer",
        json={"assigned_to": str(other_analyst.id), "reason": "Especialista no assunto"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["assigned_to"] == str(other_analyst.id)
    # Transferir devolve o chamado para triagem — quem recebeu ainda não assumiu.
    assert data["status"] == "em_triagem"

    detail = await analyst_client.get(f"/api/v1/tickets/{ticket['id']}")
    transfer_entry = [h for h in detail.json()["history"] if h["action"] == "transferido"][0]
    assert transfer_entry["comment"] == "Especialista no assunto"


async def test_employee_cannot_transfer_ticket(employee_client: AsyncClient, department):
    ticket = await _open_ticket(employee_client, department)
    response = await employee_client.post(f"/api/v1/tickets/{ticket['id']}/transfer", json={})
    assert response.status_code == 403


# ---------- anexos (agora persistidos de verdade, não só metadados) ----------


async def test_attachment_upload_persists_bytes_via_storage_service(employee_client: AsyncClient, department, db_session):
    ticket = await _open_ticket(employee_client, department)

    with patch("app.api.v1.tickets.storage_service.upload_bytes", new=AsyncMock()) as upload:
        response = await employee_client.post(
            f"/api/v1/tickets/{ticket['id']}/attachments",
            files={"file": ("comprovante.pdf", b"conteudo-do-arquivo", "application/pdf")},
        )
        assert response.status_code == 200
        upload.assert_awaited_once()
        call_kwargs = upload.await_args
        assert call_kwargs.args[1] == b"conteudo-do-arquivo"
        assert call_kwargs.args[2] == "application/pdf"

    attachment = (
        await db_session.execute(select(TicketAttachment).where(TicketAttachment.ticket_id == uuid.UUID(ticket["id"])))
    ).scalar_one()
    assert attachment.filename == "comprovante.pdf"
    assert attachment.size_bytes == len(b"conteudo-do-arquivo")

    detail = await employee_client.get(f"/api/v1/tickets/{ticket['id']}")
    assert detail.json()["attachments"][0]["filename"] == "comprovante.pdf"


# ---------- e-mail disparado nos eventos do chamado ----------


async def test_ticket_lifecycle_dispatches_email_notifications(analyst_client: AsyncClient, department):
    with patch("app.api.v1.tickets.send_ticket_email_task.delay") as delay:
        ticket = await _open_ticket(analyst_client, department)
        delay.assert_called_once_with(ticket["id"], "aberto")

    with patch("app.api.v1.tickets.send_ticket_email_task.delay") as delay:
        await analyst_client.post(f"/api/v1/tickets/{ticket['id']}/assume")
        response = await analyst_client.post(
            f"/api/v1/tickets/{ticket['id']}/comments", json={"comment": "Já estou vendo seu caso."}
        )
        assert response.status_code == 200
        delay.assert_called_once_with(ticket["id"], "respondido")

    with patch("app.api.v1.tickets.send_ticket_email_task.delay") as delay:
        close = await analyst_client.post(
            f"/api/v1/tickets/{ticket['id']}/close", json={"reason": "resolvido"}
        )
        assert close.status_code == 200
        delay.assert_called_once_with(ticket["id"], "finalizado")


async def test_internal_note_does_not_dispatch_email(analyst_client: AsyncClient, department):
    ticket = await _open_ticket(analyst_client, department)
    await analyst_client.post(f"/api/v1/tickets/{ticket['id']}/assume")

    with patch("app.api.v1.tickets.send_ticket_email_task.delay") as delay:
        response = await analyst_client.post(
            f"/api/v1/tickets/{ticket['id']}/comments",
            json={"comment": "Conferir com a folha antes de responder.", "is_internal": True},
        )
        assert response.status_code == 200
        delay.assert_not_called()


# ---------- IA descreve o contexto do chamado antes da abertura via chat ----------


async def _ask_and_get_message(client: AsyncClient) -> dict:
    with (
        patch("app.services.chat_service.embedding_service.embed_one", new=AsyncMock(return_value=[0.1] * 8)),
        patch("app.services.chat_service.vector_store.search", new=AsyncMock(return_value=[])),
        patch("app.services.chat_service.get_llm_provider") as get_provider,
    ):
        get_provider.return_value = AsyncMock()
        conv = await client.post("/api/v1/chat/conversations", json={})
        conversation_id = conv.json()["id"]
        response = await client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            json={"content": "Pergunta muito específica sem nada na base de conhecimento"},
        )
        return {"conversation_id": conversation_id, **response.json()}


async def test_draft_ticket_returns_ai_generated_context(employee_client: AsyncClient):
    asked = await _ask_and_get_message(employee_client)

    with patch("app.services.chat_service.get_llm_provider") as get_provider:
        provider = AsyncMock()
        provider.draft_ticket.return_value = {
            "subject": "Divergência no valor do vale-refeição",
            "description": "Colaborador relata valor menor que o esperado; já perguntei sobre férias no período.",
        }
        get_provider.return_value = provider

        response = await employee_client.post(
            f"/api/v1/chat/conversations/{asked['conversation_id']}/messages/{asked['message_id']}/draft-ticket",
            json={"department_id": str(uuid.uuid4())},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["subject"] == "Divergência no valor do vale-refeição"
        provider.draft_ticket.assert_awaited_once()


async def test_open_ticket_uses_edited_draft_subject_and_description(employee_client: AsyncClient, department):
    asked = await _ask_and_get_message(employee_client)

    response = await employee_client.post(
        f"/api/v1/chat/conversations/{asked['conversation_id']}/messages/{asked['message_id']}/open-ticket",
        json={
            "department_id": str(department.id),
            "category": "Vale Refeição",
            "subcategory": "Valor divergente",
            "subject": "Vale-refeição veio com valor menor",
            "description": "Resumo editado pelo colaborador antes de confirmar.",
        },
    )
    assert response.status_code == 200
    ticket_id = response.json()["id"]

    detail = await employee_client.get(f"/api/v1/tickets/{ticket_id}")
    body = detail.json()
    assert body["subject"] == "Vale-refeição veio com valor menor"
    assert body["description"] == "Resumo editado pelo colaborador antes de confirmar."
    assert body["category"] == "Vale Refeição"
    assert body["subcategory"] == "Valor divergente"
