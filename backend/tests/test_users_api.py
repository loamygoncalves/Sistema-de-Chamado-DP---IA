import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import UserRole
from app.models.user import User

pytestmark = pytest.mark.asyncio


async def test_list_analysts_returns_only_active_analysts(
    employee_client: AsyncClient, analyst_user: User, db_session: AsyncSession
):
    inactive_analyst = User(
        name="Analista Inativo",
        email="analista.inativo@beepsaude.com.br",
        role=UserRole.ANALYST,
        is_active=False,
    )
    other_employee = User(name="Outro Colaborador", email="outro.colaborador@beepsaude.com.br", role=UserRole.EMPLOYEE)
    db_session.add_all([inactive_analyst, other_employee])
    await db_session.commit()

    response = await employee_client.get("/api/v1/users/analysts")

    assert response.status_code == 200
    names = [a["name"] for a in response.json()]
    assert analyst_user.name in names
    assert "Analista Inativo" not in names
    assert "Outro Colaborador" not in names
