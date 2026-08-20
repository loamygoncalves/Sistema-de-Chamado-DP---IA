import os
import uuid
from typing import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://beep:beep@localhost:5432/beep_service_desk_test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")
os.environ.setdefault("OPENAI_API_KEY", "test")

import app.models  # noqa: E402,F401 — garante que todos os modelos estão registrados no Base.metadata
from app.core.deps import get_current_user  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.department import Department  # noqa: E402
from app.models.enums import UserRole  # noqa: E402
from app.models.user import User  # noqa: E402

TEST_DATABASE_URL = os.environ["DATABASE_URL"]


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncIterator[AsyncSession]:
    session_factory = async_sessionmaker(bind=db_engine, expire_on_commit=False, class_=AsyncSession)
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def department(db_session: AsyncSession) -> Department:
    dept = Department(name="Férias", slug="ferias", default_sla_hours=48)
    db_session.add(dept)
    await db_session.commit()
    await db_session.refresh(dept)
    return dept


@pytest_asyncio.fixture
async def employee_user(db_session: AsyncSession, department: Department) -> User:
    user = User(
        name="Colaborador Teste",
        email="colaborador.teste@beepsaude.com.br",
        matricula="10001",
        department_id=department.id,
        role=UserRole.EMPLOYEE,
        identity_provider_sub=str(uuid.uuid4()),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def analyst_user(db_session: AsyncSession) -> User:
    user = User(
        name="Analista Teste",
        email="analista.teste@beepsaude.com.br",
        matricula="20001",
        role=UserRole.ANALYST,
        identity_provider_sub=str(uuid.uuid4()),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


def _client_as(db_session: AsyncSession, user: User) -> AsyncClient:
    async def override_get_db():
        yield db_session

    async def override_get_current_user():
        return user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest_asyncio.fixture
async def employee_client(db_session: AsyncSession, employee_user: User) -> AsyncIterator[AsyncClient]:
    async with _client_as(db_session, employee_user) as client:
        yield client
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def analyst_client(db_session: AsyncSession, analyst_user: User) -> AsyncIterator[AsyncClient]:
    async with _client_as(db_session, analyst_user) as client:
        yield client
    app.dependency_overrides.clear()
