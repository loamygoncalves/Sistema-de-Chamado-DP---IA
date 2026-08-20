"""Popula dados de demonstração para ambiente local.

Idempotente: pode ser executado múltiplas vezes sem duplicar registros. Os
`identity_provider_sub` dos usuários de demonstração correspondem aos ids fixos
definidos em `infra/keycloak/realm-export.json`, então o primeiro login via SSO
com `colaborador.demo` / `analista.demo` / `admin.demo` já cai no usuário certo.

Uso:
    python -m scripts.seed_demo_data
"""

import asyncio
import uuid

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.department import Department
from app.models.enums import TicketPriority, TicketSource, UserRole
from app.models.knowledge import FAQ
from app.models.ticket import Ticket
from app.models.user import User
from app.services import knowledge_service, ticket_service

SAMPLE_TICKET_SUBJECT = "Chamado de exemplo — dúvida sobre saldo de férias"

DEMO_USERS = [
    {
        "id": uuid.UUID("a1a1a1a1-0000-4000-8000-000000000001"),
        "name": "Colaborador Demo",
        "email": "colaborador.demo@beepsaude.com.br",
        "matricula": "10001",
        "role": UserRole.EMPLOYEE,
    },
    {
        "id": uuid.UUID("a1a1a1a1-0000-4000-8000-000000000002"),
        "name": "Analista Demo",
        "email": "analista.demo@beepsaude.com.br",
        "matricula": "20001",
        "role": UserRole.ANALYST,
    },
    {
        "id": uuid.UUID("a1a1a1a1-0000-4000-8000-000000000003"),
        "name": "Admin Demo",
        "email": "admin.demo@beepsaude.com.br",
        "matricula": "30001",
        "role": UserRole.ADMIN,
    },
]

DEMO_FAQS = [
    (
        "Como funciona o banco de horas?",
        "As horas excedentes são compensadas em até 6 meses, mediante acordo com a liderança. "
        "O saldo pode ser consultado no portal do colaborador em Ponto > Banco de horas.",
        "banco-de-horas",
    ),
    (
        "Como solicitar férias?",
        "Solicite pelo portal do colaborador com pelo menos 30 dias de antecedência. "
        "O RH aprova em até 5 dias úteis e o aviso de férias é gerado automaticamente.",
        "ferias",
    ),
    (
        "Como incluir dependente no plano de saúde?",
        "Envie certidão de nascimento/casamento e CPF do dependente pelo portal de chamados, "
        "categoria Plano de saúde. A inclusão é homologada pela operadora em até 10 dias úteis.",
        "plano-de-saude",
    ),
    (
        "Qual a política de home office?",
        "Modelo híbrido: mínimo de 2 dias presenciais por semana, definidos com o gestor direto. "
        "Ajuda de custo de internet é creditada junto ao salário.",
        None,
    ),
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        departments = {
            d.slug: d for d in (await db.execute(select(Department))).scalars().all()
        }

        for demo in DEMO_USERS:
            existing = await db.get(User, demo["id"])
            if existing is None:
                db.add(
                    User(
                        id=demo["id"],
                        name=demo["name"],
                        email=demo["email"],
                        matricula=demo["matricula"],
                        role=demo["role"],
                        identity_provider_sub=str(demo["id"]),
                    )
                )
        await db.flush()

        existing_faq_questions = {f.question for f in (await db.execute(select(FAQ))).scalars().all()}
        for question, answer, dept_slug in DEMO_FAQS:
            if question in existing_faq_questions:
                continue
            department = departments.get(dept_slug) if dept_slug else None
            await knowledge_service.create_faq(
                db, question=question, answer=answer, department_id=department.id if department else None
            )

        employee = await db.get(User, DEMO_USERS[0]["id"])
        sample_department = departments.get("ferias")
        if employee and sample_department:
            already_seeded = (
                await db.execute(
                    select(Ticket).where(
                        Ticket.requester_id == employee.id, Ticket.subject == SAMPLE_TICKET_SUBJECT
                    )
                )
            ).scalar_one_or_none()
            if already_seeded is None:
                await ticket_service.create_ticket(
                    db,
                    requester=employee,
                    department_id=sample_department.id,
                    subject=SAMPLE_TICKET_SUBJECT,
                    description="Chamado gerado pelo script de seed para fins de demonstração.",
                    priority=TicketPriority.BAIXA,
                    source=TicketSource.MANUAL,
                )

        await db.commit()
        print("Seed de demonstração concluído.")


if __name__ == "__main__":
    asyncio.run(seed())
