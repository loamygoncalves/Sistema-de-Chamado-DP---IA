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

# Conteúdo extraído do "Guia do Colaborador" (deck de onboarding da BEEP Saúde) +
# algumas perguntas complementares, para que a IA já nasça respondendo com
# informação real de benefícios e processos de DP.
DEMO_FAQS = [
    (
        "Quando e onde recebo meu salário?",
        "O pagamento ocorre no 5º dia útil de cada mês (o sábado conta como dia útil), com depósito "
        "exclusivo nas contas Bradesco ou Next. Para outro banco, solicite a portabilidade salarial "
        "diretamente na instituição financeira de sua preferência.",
        "folha-de-pagamento",
    ),
    (
        "Como solicitar férias?",
        "Solicite pelo portal do colaborador com pelo menos 30 dias de antecedência. "
        "O RH aprova em até 5 dias úteis e o aviso de férias é gerado automaticamente.",
        "ferias",
    ),
    (
        "Como funciona o Vale Refeição/Alimentação?",
        "O benefício provisório fica disponível em até 72h úteis no cartão provisório (diarista 6h: "
        "R$ 15,00/dia; diarista/plantonista acima de 6h: R$ 30,00/dia). O cartão definitivo é enviado "
        "até a 1ª semana do mês seguinte à admissão, já com a carga do benefício do mês. É necessário "
        "criar login no app da Ticket e adicionar o cartão.",
        "vale-refeicao",
    ),
    (
        "Como funciona o Vale Transporte?",
        "O benefício provisório é disponibilizado em até 72h úteis via Pix ou na conta Bradesco/Next, "
        "com desconto de 6% do salário base. O benefício definitivo exige o cartão em mãos, com depósito "
        "até o dia 25 de cada mês para uso no mês seguinte. Extras de VT e Ticket Refeição/Alimentação, "
        "calculados pelos dias trabalhados além da escala, são disponibilizados sempre no dia 20 do mês seguinte.",
        "vale-transporte",
    ),
    (
        "Como funciona o Plano de Saúde?",
        "O titular não paga mensalidade, apenas 30% de coparticipação em qualquer utilização. Dependentes "
        "(filhos e cônjuge) pagam mensalidade conforme tabela de valores, também com 30% de coparticipação. "
        "A ativação ocorre até o dia 10 do mês seguinte à admissão para o BackOffice, e em até 3 meses para "
        "o time operacional. O acesso é pelo aplicativo do plano, com os dados pessoais.",
        "plano-de-saude",
    ),
    (
        "Como incluir dependente no plano de saúde?",
        "Envie certidão de nascimento/casamento e CPF do dependente pelo portal de chamados, "
        "categoria Plano de saúde. A inclusão é homologada pela operadora em até 10 dias úteis.",
        "plano-de-saude",
    ),
    (
        "Como funciona o Plano Odontológico?",
        "O titular não paga mensalidade nem coparticipação. Dependentes (filhos e cônjuge) pagam "
        "mensalidade de R$ 12,12, sem coparticipação. A ativação segue o mesmo prazo do plano de saúde: "
        "até o dia 10 do mês seguinte à admissão (BackOffice) ou 3 meses (operacional). Acesso pelo "
        "aplicativo do plano.",
        "plano-odontologico",
    ),
    (
        "Como funciona a Telemedicina Conexa Saúde?",
        "Titular e dependentes no plano têm acesso sem mensalidade e sem coparticipação a atendimentos "
        "de clínico geral, nutricionista e psicólogo. Prazo de ativação: até o dia 10 do mês seguinte à "
        "admissão (BackOffice) ou 3 meses (operacional). Acesso pelo aplicativo, com os dados pessoais.",
        "telemedicina-conexa",
    ),
    (
        "Como funciona o TotalPass?",
        "O acesso segue o plano escolhido na plataforma, sem coparticipação, com as redes disponíveis "
        "no próprio app. A ativação ocorre no dia 10 do mês seguinte à admissão.",
        "totalpass",
    ),
    (
        "Como funciona o Wellhub (Gympass)?",
        "Assim como o TotalPass, o acesso segue o plano escolhido na plataforma, sem coparticipação. "
        "A ativação ocorre no dia 10 do mês seguinte à admissão, com acesso pelo aplicativo.",
        "gympass",
    ),
    (
        "O que cobre o Seguro de Vida?",
        "É sem custo para o titular e inclui assistência funeral (para titular e dependentes), coroa de "
        "flores (para pais, cônjuge e filhos) e cartão natalidade em caso de nascimento de filho(a).",
        "seguro-de-vida",
    ),
    (
        "Quem tem direito ao Auxílio Creche e qual o valor?",
        "Têm direito mães com filho de até 6 anos (no mês do aniversário) e pais com filho de até 6 anos "
        "com guarda judicial total da criança. O valor mensal é de R$ 324,20 no Rio de Janeiro e R$ 361,31 "
        "em São Paulo. São aceitos recibo de papelaria assinado por ambas as partes com valor, ou boleto "
        "da creche com comprovante de pagamento.",
        "auxilio-creche",
    ),
    (
        "Como funciona o registro de ponto?",
        "O ponto é biométrico, registrado por impressão digital em qualquer um dos Hubs, com tolerância "
        "de marcação de 10 minutos. Em caso de divergência, o ajuste deve ser feito no portal ADP, onde "
        "também são consultados contracheques, informe de rendimentos, benefícios e dependentes ativos.",
        "ponto",
    ),
    (
        "Como funciona o banco de horas?",
        "A janela do banco de horas é de 6 em 6 meses. Em dias de escala, as 2 primeiras horas extras "
        "viram banco de horas e o restante é pago como hora extra; em dias de folga, plantonistas recebem "
        "hora extra e diaristas recebem crédito no banco de horas. Toda hora extra precisa ser autorizada "
        "pela gestão. O ponto de um mês é apurado até o dia 31, processado na folha do mês seguinte e "
        "pago no 5º dia útil do mês posterior a esse.",
        "banco-de-horas",
    ),
    (
        "Como atualizar meus dados cadastrais?",
        "A atualização é feita pelo portal de chamados do RH, abrindo uma solicitação com o dado a ser "
        "alterado: endereço, telefone, e-mail, dados bancários, dependentes, estado civil, ofício de "
        "pensão, registro profissional (COREN, CRF) ou CNH válida com EAR.",
        "atualizacao-cadastral",
    ),
    (
        "Como proceder em caso de afastamento ou atestado médico?",
        "Avise sua liderança imediatamente, envie o atestado pelo canal indicado pelo RH e aguarde o "
        "contato do time de saúde e segurança do trabalho. Os documentos comprobatórios devem ser "
        "enviados em até 24h para serem lançados no sistema.",
        None,
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
