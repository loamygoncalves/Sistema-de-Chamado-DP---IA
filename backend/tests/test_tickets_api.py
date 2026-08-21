import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.department import Department
from app.models.user import User

pytestmark = pytest.mark.asyncio


async def test_ticket_without_priority_uses_department_default(
    employee_client: AsyncClient, department: Department, db_session
):
    # A fila "ferias" nasce com prioridade padrão "media" (migração 0004).
    response = await employee_client.post(
        "/api/v1/tickets",
        json={
            "department_id": str(department.id),
            "subject": "Dúvida sobre saldo de férias",
            "description": "Quero saber quantos dias de férias ainda tenho.",
        },
    )
    assert response.status_code == 200
    assert response.json()["priority"] == department.default_priority.value


async def test_high_priority_department_opens_ticket_as_critical(employee_client: AsyncClient, db_session):
    payroll = (
        await db_session.execute(select(Department).where(Department.slug == "folha-de-pagamento"))
    ).scalar_one()

    response = await employee_client.post(
        "/api/v1/tickets",
        json={
            "department_id": str(payroll.id),
            "subject": "Salário não caiu",
            "description": "Meu salário deveria ter caído hoje e não caiu.",
        },
    )
    assert response.status_code == 200
    assert response.json()["priority"] == "critica"


async def test_low_priority_department_opens_ticket_as_low(employee_client: AsyncClient, db_session):
    adp_access = (
        await db_session.execute(select(Department).where(Department.slug == "atualizacao-cadastral"))
    ).scalar_one()

    response = await employee_client.post(
        "/api/v1/tickets",
        json={
            "department_id": str(adp_access.id),
            "subject": "Não consigo acessar o Portal ADP",
            "description": "Esqueci minha senha do Portal ADP.",
        },
    )
    assert response.status_code == 200
    assert response.json()["priority"] == "baixa"


async def test_employee_can_open_and_view_own_ticket(employee_client: AsyncClient, department: Department):
    response = await employee_client.post(
        "/api/v1/tickets",
        json={
            "department_id": str(department.id),
            "subject": "Dúvida sobre saldo de férias",
            "description": "Quero saber quantos dias de férias ainda tenho.",
            "priority": "media",
        },
    )
    assert response.status_code == 200
    ticket = response.json()
    assert ticket["ticket_number"].startswith("BEEP-")
    assert ticket["status"] == "novo"

    detail = await employee_client.get(f"/api/v1/tickets/{ticket['id']}")
    assert detail.status_code == 200
    assert detail.json()["history"][0]["action"] == "criado"


async def test_employee_cannot_view_others_ticket(
    employee_client: AsyncClient, department: Department, analyst_user: User, db_session
):
    from app.services import ticket_service

    other_ticket = await ticket_service.create_ticket(
        db_session,
        requester=analyst_user,
        department_id=department.id,
        subject="Chamado de outra pessoa",
        description="Não deveria ser visível para o colaborador de teste.",
    )
    await db_session.commit()

    response = await employee_client.get(f"/api/v1/tickets/{other_ticket.id}")
    assert response.status_code == 403


async def test_employee_cannot_assume_ticket(employee_client: AsyncClient, department: Department):
    create_resp = await employee_client.post(
        "/api/v1/tickets",
        json={"department_id": str(department.id), "subject": "Teste", "description": "Teste"},
    )
    ticket_id = create_resp.json()["id"]

    response = await employee_client.post(f"/api/v1/tickets/{ticket_id}/assume")
    assert response.status_code == 403


async def test_analyst_full_lifecycle(analyst_client: AsyncClient, department: Department, employee_user: User, db_session):
    from app.services import ticket_service

    ticket = await ticket_service.create_ticket(
        db_session,
        requester=employee_user,
        department_id=department.id,
        subject="Chamado para o ciclo de vida",
        description="Chamado de teste do analista.",
    )
    await db_session.commit()

    assume = await analyst_client.post(f"/api/v1/tickets/{ticket.id}/assume")
    assert assume.status_code == 200
    assert assume.json()["status"] == "em_atendimento"

    priority = await analyst_client.patch(f"/api/v1/tickets/{ticket.id}/priority", json={"priority": "alta"})
    assert priority.status_code == 200
    assert priority.json()["priority"] == "alta"

    comment = await analyst_client.post(f"/api/v1/tickets/{ticket.id}/comments", json={"comment": "Analisando o caso."})
    assert comment.status_code == 200

    close = await analyst_client.post(f"/api/v1/tickets/{ticket.id}/close", json={"status": "encerrado", "comment": "Resolvido."})
    assert close.status_code == 200
    assert close.json()["status"] == "encerrado"
    assert close.json()["closed_at"] is not None


async def test_ticket_priority_recomputes_sla(analyst_client: AsyncClient, department: Department, employee_user: User, db_session):
    from app.services import ticket_service

    ticket = await ticket_service.create_ticket(
        db_session,
        requester=employee_user,
        department_id=department.id,
        subject="SLA deve mudar com a prioridade",
        description="Teste de recomputo de SLA.",
    )
    await db_session.commit()
    original_sla = ticket.sla_due_at

    response = await analyst_client.patch(f"/api/v1/tickets/{ticket.id}/priority", json={"priority": "critica"})
    assert response.status_code == 200
    new_sla = response.json()["sla_due_at"]
    assert new_sla != original_sla.isoformat()


async def test_internal_note_is_hidden_from_requester_but_visible_to_analyst(
    client_as, department: Department, employee_user: User, analyst_user: User, db_session
):
    from app.services import ticket_service

    ticket = await ticket_service.create_ticket(
        db_session,
        requester=employee_user,
        department_id=department.id,
        subject="Chamado com nota interna",
        description="Preciso de ajuda com o benefício.",
    )
    await db_session.commit()

    publica = "Oi! Já estou verificando com a folha."
    interna = "Conferir se o desconto veio do consignado antes de responder."

    async with client_as(analyst_user) as analyst:
        public = await analyst.post(
            f"/api/v1/tickets/{ticket.id}/comments", json={"comment": publica, "is_internal": False}
        )
        assert public.status_code == 200
        assert public.json()["is_internal"] is False

        internal = await analyst.post(
            f"/api/v1/tickets/{ticket.id}/comments", json={"comment": interna, "is_internal": True}
        )
        assert internal.status_code == 200
        assert internal.json()["is_internal"] is True

        # O analista vê as duas mensagens...
        analyst_comments = [h["comment"] for h in (await analyst.get(f"/api/v1/tickets/{ticket.id}")).json()["history"]]
        assert publica in analyst_comments
        assert interna in analyst_comments

    # ...mas o colaborador solicitante só vê a resposta pública.
    async with client_as(employee_user) as employee:
        employee_history = (await employee.get(f"/api/v1/tickets/{ticket.id}")).json()["history"]

    employee_comments = [h["comment"] for h in employee_history]
    assert publica in employee_comments
    assert interna not in employee_comments
    assert all(h["is_internal"] is False for h in employee_history)


async def test_requester_cannot_create_internal_note(
    employee_client: AsyncClient, department: Department, employee_user: User, db_session
):
    from app.services import ticket_service

    ticket = await ticket_service.create_ticket(
        db_session,
        requester=employee_user,
        department_id=department.id,
        subject="Colaborador tentando nota interna",
        description="Teste.",
    )
    await db_session.commit()

    # A flag é ignorada em vez de criar uma nota que o próprio autor não veria.
    response = await employee_client.post(
        f"/api/v1/tickets/{ticket.id}/comments",
        json={"comment": "Isso deveria ser público.", "is_internal": True},
    )
    assert response.status_code == 200
    assert response.json()["is_internal"] is False


async def test_ticket_detail_resolves_names_for_the_analyst_screen(
    analyst_client: AsyncClient, department: Department, employee_user: User, analyst_user: User, db_session
):
    from app.services import ticket_service

    ticket = await ticket_service.create_ticket(
        db_session,
        requester=employee_user,
        department_id=department.id,
        subject="Nomes resolvidos",
        description="Teste.",
    )
    await db_session.commit()

    await analyst_client.post(f"/api/v1/tickets/{ticket.id}/assume")
    detail = (await analyst_client.get(f"/api/v1/tickets/{ticket.id}")).json()

    assert detail["requester_name"] == employee_user.name
    assert detail["requester_email"] == employee_user.email
    assert detail["assigned_to_name"] == analyst_user.name
    assert detail["department_name"] == department.name
    # O autor de cada evento vem resolvido para a timeline não mostrar UUID.
    assert any(h["actor_name"] == employee_user.name for h in detail["history"])
