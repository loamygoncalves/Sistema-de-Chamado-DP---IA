"""Popula FAQs derivadas da análise do histórico de chamados do TomTicket
(1899 chamados de Departamento Pessoal, ago/2025-ago/2026).

As perguntas e respostas aqui são generalizações escritas a partir de padrões
recorrentes — nenhuma reproduz o texto literal de um chamado específico, e
nenhum dado pessoal (nome, CPF, matrícula, valores individuais) foi mantido.
O relatório completo da análise (taxonomia, árvores de decisão por categoria e
metodologia) está em `docs/TOMTICKET_KNOWLEDGE_BASE.md`; a mesma análise
também gerou os arquivos de conhecimento em
`infra/knowledge-base/departamento-pessoal/` para a sincronização automática
com a pasta local/de rede.

Idempotente: pula perguntas que já existem na base.

Uso:
    python -m scripts.seed_faqs_from_tomticket
"""

import asyncio

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.department import Department
from app.models.knowledge import FAQ
from app.services import knowledge_service

# (pergunta, resposta, slug do departamento ou None quando não há fila específica)
DEMO_FAQS_TOMTICKET = [
    ("Como faço para receber o auxílio creche?", "Envie mensalmente, por chamado, o comprovante de pagamento da creche ou cuidadora com nome da criança, valor e mês de referência. O reembolso entra no pagamento processado após o envio, respeitando a data de corte do mês.", "auxilio-creche"),
    ("Por que não recebi o auxílio creche este mês?", "As causas mais comuns são: comprovante enviado após a data de corte do mês (entra na competência seguinte), comprovante incompleto/ilegível, ou a criança está fora da faixa etária prevista na política do benefício. Confira esses pontos e reenvie se necessário.", "auxilio-creche"),
    ("Meu vale transporte não caiu esse mês, o que houve?", "Confira se a solicitação foi feita antes do dia 15 (data de corte) — pedidos depois disso entram na recarga do mês seguinte. Se o pedido foi feito a tempo e mesmo assim não caiu, é preciso abrir chamado para o DP investigar com a operadora.", "vale-transporte"),
    ("Meu cartão não está integrando entre ônibus e metrô, o que fazer?", "Após a ativação da integração, aguarde até 48 horas úteis e tente novamente encostando o cartão em qualquer meio de transporte, ou use um Validador/Terminal de Consulta da operadora para ativação imediata.", "vale-transporte"),
    ("Meu acesso ao ADP travou por excesso de tentativas, o que fazer?", "O ADP eXpert passou por uma atualização no processo de login. Exclua o link antigo salvo em favoritos, acesse pelo link oficial atual e siga o fluxo de migração: cadastro de e-mail e telefone, seguido da validação por código.", None),
    ("Como atualizo minha CNH ou registro profissional (Coren) no cadastro?", "Abra um chamado anexando o documento atualizado, legível e completo. O Departamento Pessoal confirma o recebimento e realiza a atualização cadastral.", "atualizacao-cadastral"),
    ("Posso incluir um dependente no plano de saúde a qualquer momento?", "Não. A inclusão só é permitida no momento da ativação do titular no plano, ou em até 30 dias após um evento elegível como nascimento de filho ou casamento. Fora dessas janelas, não é possível incluir dependentes pelas regras atuais do plano.", "plano-de-saude"),
    ("Posso manter o plano de saúde depois de sair da empresa?", "Não. O plano de saúde é 100% custeado pela empresa, então não é possível permanecer nele após o desligamento — exceto em casos de determinação judicial de estabilidade, que mantém o plano ativo apenas até o fim do período determinado.", "plano-de-saude"),
    ("Meu salário veio menor do que o esperado, é um erro?", "Nem sempre — muitas vezes o salário aparece dividido em eventos separados no contracheque (por exemplo, salário base + evento de atestado), que juntos totalizam o valor contratual. Confira o contracheque completo, não só o valor líquido. Se a soma dos eventos não bater com o esperado, é necessário abrir chamado para o DP investigar.", "folha-de-pagamento"),
    ("Como peço a segunda via do cartão de vale-refeição?", "A solicitação de 2ª via deve ser feita diretamente pelo aplicativo da operadora (Ticket), na opção \"Pedir 2ª via\". O prazo de entrega é de até 7 dias úteis no seu hub. O saldo do cartão provisório não é transferido automaticamente para o cartão definitivo.", "vale-refeicao"),
    ("Mudei de endereço, como atualizo meu vale transporte?", "Envie o comprovante de endereço atualizado junto ao chamado, detalhando o trajeto de ida e volta e os meios de transporte usados. A atualização entra em vigor a partir da competência seguinte se o pedido for feito depois do dia 15.", "vale-transporte"),
    ("Posso receber 100% do meu benefício em Vale Alimentação?", "Depende da sua função. Para funções com rotina externa (como motoristas), parte do benefício precisa permanecer em Vale Refeição para custear as refeições durante a jornada. Para as demais funções, a troca de percentual pode ser solicitada por chamado e vale a partir da competência seguinte ao pedido.", None),
    ("Como incluo meu filho ou cônjuge no plano odontológico?", "A inclusão só é permitida no momento da ativação do titular no plano, ou em até 30 dias após um evento elegível (nascimento de filho, casamento). Fora dessas janelas, não é possível incluir dependentes pelas regras atuais do plano.", "plano-odontologico"),
    ("Como envio meu atestado médico para abonar uma falta?", "Documentos para abono de falta devem ser enviados pelo portal Pipefy, preenchendo todas as informações solicitadas no formulário de envio de documentação.", "ponto"),
    ("Mudei de plantão/escala, preciso ajustar algo no ponto?", "Sim — mas antes o DP precisa receber a formalização da mudança pela sua gestão direta. Só depois disso o ajuste pode ser refletido na sua folha de ponto.", "ponto"),
    ("Perdi ou danifiquei meu crachá, o que fazer?", "Abra um chamado informando o motivo (perda, dano, roubo ou movimentação interna). O pedido de nova via é registrado com prazo de entrega de até 7 dias úteis.", None),
    ("Quero cancelar meu vale transporte, quando o desconto para?", "A renúncia é processada a partir da competência seguinte ao pedido (respeitando o corte do dia 15). O desconto de VT deixa de ocorrer a partir da folha da competência em que a renúncia já estiver registrada.", "vale-transporte"),
    ("Como solicito uma declaração de vínculo empregatício?", "Abra um chamado detalhando a finalidade da declaração e os dados que ela precisa conter (cargo, período, atividades). O documento é emitido em papel timbrado da empresa.", "declaracoes"),
    ("Não consigo acessar meu contracheque, o que fazer?", "O acesso ao contracheque é feito pelo Portal ADP. Se está bloqueado, siga o fluxo de migração do ADP eXpert: link oficial atualizado, cadastro de e-mail/telefone e validação por código.", None),
    ("Como me cadastro no Gympass/Wellhub?", "Baixe o aplicativo e cadastre-se usando o mesmo e-mail informado no momento da admissão. Colaboradores admitidos no mês têm cadastro disponível a partir do dia 10 do mês seguinte.", "gympass"),
    ("Como cancelo o TotalPass?", "O cancelamento é feito por e-mail dedicado, informando nome completo, matrícula, RG e CPF. O benefício permanece ativo até o final do ciclo vigente.", "totalpass"),
    ("Posso contestar o valor do meu empréstimo consignado com o DP?", "O DP apenas aplica o desconto conforme as informações recebidas da base oficial do Crédito do Trabalhador/eSocial. Divergências de valor ou de número de parcelas precisam ser resolvidas diretamente com o banco credor.", "emprestimo-consignado"),
    ("Como agendo minhas férias?", "O agendamento de férias precisa ser alinhado diretamente com o seu gestor. O DP confirma e processa a programação depois desse alinhamento.", "ferias"),
]


async def main() -> None:
    async with AsyncSessionLocal() as db:
        departments = {d.slug: d for d in (await db.execute(select(Department))).scalars().all()}
        existing_questions = {f.question for f in (await db.execute(select(FAQ))).scalars().all()}

        created = 0
        for question, answer, dept_slug in DEMO_FAQS_TOMTICKET:
            if question in existing_questions:
                continue
            department = departments.get(dept_slug) if dept_slug else None
            await knowledge_service.create_faq(
                db, question=question, answer=answer, department_id=department.id if department else None
            )
            created += 1

        await db.commit()
        print(f"{created} FAQs novas criadas ({len(DEMO_FAQS_TOMTICKET) - created} já existiam).")


if __name__ == "__main__":
    asyncio.run(main())
