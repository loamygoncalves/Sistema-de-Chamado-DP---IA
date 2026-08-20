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

# Conteúdo extraído do "Guia do Colaborador Detalhado" (documento oficial de DP da
# BEEP Saúde) + complementos do deck de onboarding, para que a IA já nasça
# respondendo com informação real de benefícios e processos de DP.
DEMO_FAQS = [
    (
        "Quando e onde recebo meu salário?",
        "O pagamento ocorre no 5º dia útil de cada mês (o sábado conta como dia útil), exclusivamente "
        "nas contas Bradesco ou Next (conta salário ou conta corrente). Para abrir a conta salário "
        "online, use o Código de Convênio 180801805 e o CNPJ 28.286.170/0001-01. Para receber em outro "
        "banco, solicite a portabilidade salarial diretamente na instituição financeira de sua preferência.",
        "folha-de-pagamento",
    ),
    (
        "Como funciona o pagamento do 13º salário?",
        "O 13º é pago em duas parcelas: a primeira até 30/11, correspondente a 50% do valor total e sem "
        "descontos; a segunda até 20/12, já com desconto de INSS e Imposto de Renda.",
        "folha-de-pagamento",
    ),
    (
        "Como solicitar férias e o que reduz a quantidade de dias?",
        "Os gestores devem solicitar até o dia 10 do mês anterior ao mês de gozo, e o depósito ocorre "
        "até 2 dias antes do início do período aprovado. Atenção: faltas injustificadas no período "
        "aquisitivo de 12 meses reduzem os dias de férias (Art. 130 da CLT) — até 5 faltas mantém os 30 "
        "dias corridos; de 6 a 14 faltas reduz para 24 dias; de 15 a 23 faltas para 18 dias; de 24 a 32 "
        "faltas para 12 dias; acima de 32 faltas há perda do direito às férias no período.",
        "ferias",
    ),
    (
        "Como funciona o Vale Refeição/Alimentação?",
        "No mês da admissão (provisório), o valor é depositado no cartão entregue no onboarding em até "
        "72h úteis, com desconto de 1 dia de trabalho — se a admissão ocorrer após o dia 15, o depósito já "
        "contempla o mês seguinte também (ex.: admissão em 17/01 cobre de 17/01 a 28/02). Depois da "
        "admissão (definitivo), o valor é creditado todo dia 25 no cartão definitivo entregue no Hub, "
        "para uso no mês seguinte, também com desconto de 1 dia de trabalho. Solicitações e atualizações "
        "de benefícios devem ser feitas até o dia 15 de cada mês.",
        "vale-refeicao",
    ),
    (
        "Como funciona o Vale Transporte?",
        "No mês da admissão (provisório), o valor é depositado via Pix ou na conta Bradesco/Next aberta "
        "na admissão, em até 72h úteis, com desconto de 6% do salário base. Depois da admissão "
        "(definitivo), é creditado no cartão da operadora até o último dia do mês, com o mesmo desconto "
        "de 6% do salário base — é necessário ter o cartão em mãos.",
        "vale-transporte",
    ),
    (
        "Como funcionam os benefícios extras de VT e VR/VA?",
        "Vale-Transporte e Refeição/Alimentação extras, referentes a dias trabalhados além da escala "
        "habitual, são calculados com base nesses dias e disponibilizados no dia 20 do mês seguinte.",
        "vale-refeicao",
    ),
    (
        "Como funciona o Plano de Saúde (Bradesco Saúde)?",
        "O titular não paga mensalidade, apenas 30% de coparticipação em consultas e exames simples, e "
        "30% em pronto atendimento (limitado a R$ 150,00). Dependentes legais (filhos e cônjuge) pagam "
        "mensalidade conforme tabela, com a mesma coparticipação. Ativação do titular: BackOffice até o "
        "dia 10 do mês seguinte à admissão, Time Operacional em 3 meses; dependente em até 30 dias da "
        "admissão, nascimento ou casamento. Acesso pelo app do plano no primeiro acesso, com os dados "
        "pessoais. O repasse de coparticipação pode levar até 3 meses do procedimento.",
        "plano-de-saude",
    ),
    (
        "Quais serviços adicionais o Plano de Saúde oferece?",
        "Meu Doutor Bradesco Saúde dá acesso facilitado a profissionais selecionados; a Novamed é uma "
        "rede de clínicas integrada, sem coparticipação e com telemedicina em algumas unidades; a Saúde "
        "Digital é telemedicina por vídeo disponível 24h; e o Clube + Saúde oferece descontos em lojas e "
        "estabelecimentos parceiros. Atendimento: capitais e regiões metropolitanas 4004-2700; demais "
        "localidades 0800 701 2700.",
        "plano-de-saude",
    ),
    (
        "Como incluir dependente no plano de saúde?",
        "A solicitação deve ser feita em até 30 dias da admissão, do nascimento ou do casamento, "
        "enviando os documentos do dependente pelo portal de chamados, categoria Plano de saúde.",
        "plano-de-saude",
    ),
    (
        "Como funciona o Plano Odontológico?",
        "O titular não paga mensalidade nem coparticipação. Dependentes legais pagam mensalidade de "
        "R$ 12,12, sem coparticipação. Mesmos prazos de ativação do plano de saúde. Convênio Bradesco "
        "Seguros, acesso pelo app no primeiro acesso.",
        "plano-odontologico",
    ),
    (
        "Como funciona a Conexa Saúde (Telemedicina)?",
        "O titular não paga mensalidade nem coparticipação; dependentes legais pagam R$ 12,12, sem "
        "coparticipação. Ativação do titular segue a área de atuação (BackOffice até o dia 10 do mês "
        "seguinte à admissão, operacional em 3 meses); a do dependente depende da ativação do Plano de "
        "Saúde. Acesso pelo app no primeiro acesso.",
        "telemedicina-conexa",
    ),
    (
        "O que cobre o Seguro de Vida MetLife?",
        "É sem custo para o colaborador. Inclui assistência funeral para titular e dependentes legais, "
        "coroa de flores para pais, cônjuge e filhos, e cartão natalidade em caso de nascimento de "
        "filho(a).",
        "seguro-de-vida",
    ),
    (
        "Como funciona o TotalPass?",
        "A mensalidade do titular e dos dependentes legais segue o plano escolhido na plataforma, sem "
        "coparticipação. Ativação até o dia 10 do mês seguinte à admissão; a do dependente ocorre após a "
        "ativação do titular. Acesso pelo app, informando e-mail pessoal e a empresa Beep Saúde no "
        "primeiro acesso.",
        "totalpass",
    ),
    (
        "Como funciona o Wellhub (antigo Gympass)?",
        "Assim como o TotalPass, a mensalidade segue o plano escolhido na plataforma, sem coparticipação "
        "para titular ou dependentes. Ativação até o dia 10 do mês seguinte à admissão, com acesso pelo "
        "app usando e-mail pessoal e informando a empresa Beep Saúde.",
        "gympass",
    ),
    (
        "Tenho desconto em vacinas e exames?",
        "Sim — você e sua família (cônjuge e filhos) têm 10% de desconto em vacinas e 20% em exames. "
        "Preencha o formulário do time Comercial em app.pipefy.com/public/form/cY3fhrUL para gerar o "
        "cupom de desconto.",
        "declaracoes",
    ),
    (
        "Quem tem direito ao Auxílio Creche e como solicitar?",
        "Têm direito mães com filho de até 6 anos (no mês do aniversário) e pais com filho de até 6 anos "
        "com guarda judicial total da criança. O valor mensal é de R$ 324,20 no Rio de Janeiro e R$ 361,31 "
        "em São Paulo. Envie recibo de papelaria assinado com valor, ou boleto da creche com comprovante "
        "de pagamento, até o dia 20 de cada mês, por chamado na plataforma TomTicket "
        "(beep.tomticket.com/helpdesk).",
        "auxilio-creche",
    ),
    (
        "Como solicitar pensão alimentícia (ofício de pensão)?",
        "Envie o ofício de pensão com os dados bancários do recebedor por chamado na plataforma "
        "TomTicket (beep.tomticket.com/helpdesk).",
        "declaracoes",
    ),
    (
        "Como funciona o registro de ponto?",
        "O ponto é biométrico (impressão digital), registrado em qualquer Hub, com marcação apenas de "
        "entrada e saída e tolerância de 10 minutos. Divergências são ajustadas no Portal ADP, onde "
        "também ficam disponíveis contracheques, informe de rendimentos, benefícios cadastrados, "
        "dependentes ativos e ajustes de ponto. O acesso é enviado por e-mail.",
        "ponto",
    ),
    (
        "Como funciona o banco de horas e as horas extras?",
        "A janela do banco de horas é semestral: 1ª janela de fevereiro a julho, 2ª de agosto a janeiro — "
        "ao encerrar cada janela, os valores finais são pagos ou descontados em folha. Diaristas (6x1 e "
        "5x2): em dias de escala, as 2 primeiras horas excedentes entram para o banco e o restante é hora "
        "extra; em dias de folga, tudo vira crédito de banco de horas. Plantonistas (12x36): mesma regra "
        "das 2 primeiras horas em dias de escala; em folgas, tudo é hora extra. O fechamento do ponto "
        "ocorre no 3º dia útil do mês — depois disso não é possível fazer ajuste nem reembolso retroativo.",
        "banco-de-horas",
    ),
    (
        "Quais dados devo manter atualizados e como faço isso?",
        "Mantenha atualizados: endereço, telefone, e-mail, dados bancários, dependentes, estado civil, "
        "registro profissional (COREN, CRF) e CNH válida com EAR. A atualização é feita por chamado na "
        "plataforma TomTicket (beep.tomticket.com/helpdesk).",
        "atualizacao-cadastral",
    ),
    (
        "Como enviar um atestado médico por ausência no trabalho?",
        "Abra o chamado pela plataforma Pipefy (app.pipefy.com/public/form/4qqvxrxk) e aguarde o contato "
        "do time de Saúde do Trabalho para dar seguimento ao lançamento do documento.",
        "declaracoes",
    ),
    (
        "Quais são as ausências legais previstas e seus prazos?",
        "Atestado ou declaração de horas: abono do período com documento comprobatório. Licença "
        "falecimento: 3 dias consecutivos a partir da data registrada no documento, para ascendentes e "
        "descendentes (pais, irmãos, filhos, netos, bisnetos, avós, bisavós). Licença casamento: 5 dias em "
        "São Paulo ou 3 dias no Rio de Janeiro e Distrito Federal, a partir da data do documento. "
        "Acompanhamento médico familiar: 1 dia por ano para levar filho de até 6 anos ao médico, ou até 6 "
        "consultas/exames da companheira durante a gravidez (o documento deve ter nome do colaborador e "
        "do dependente, data do atendimento, carimbo e assinatura do médico). Licença paternidade: 5 dias "
        "corridos a partir da comprovação da paternidade, conforme a CLT.",
        "declaracoes",
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
