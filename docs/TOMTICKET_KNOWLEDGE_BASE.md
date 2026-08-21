# Base de conhecimento do DP a partir do histórico do TomTicket

Análise do histórico de chamados exportado do TomTicket (1.899 chamados de
Departamento Pessoal), transformado em base de conhecimento estruturada para
o Agente de IA — não como respostas decoradas, mas como o raciocínio
investigativo que os analistas já usam: o que verificar, as causas prováveis
e a orientação típica para cada tipo de assunto.

## Como isso se conecta ao sistema

- **`infra/knowledge-base/departamento-pessoal/*.txt`** — um arquivo por
  categoria, no mesmo formato que a sincronização automática (local ou Google
  Drive) já lê. Nenhuma ação manual é necessária: esses arquivos entram na
  base de conhecimento normalmente.
- **`backend/scripts/seed_faqs_from_tomticket.py`** — popula a tabela de FAQs
  com as perguntas mais recorrentes (opcional, ver seção "Como usar" abaixo).
- **`backend/app/services/ai_providers.py`** — o prompt do modelo (`SYSTEM_PROMPT`)
  foi atualizado para instruir esse raciocínio investigativo (Fase 6, seção
  abaixo).

## Metodologia e limitações

- **Anonimização**: nome do solicitante, CPF, matrícula, e-mail e telefone
  foram removidos antes de qualquer leitura ou processamento. Nomes de
  terceiros mencionados livremente no corpo das mensagens (ex.: nome de um
  dependente) não são detectáveis por regex e podem não ter sido removidos —
  por isso nenhum texto de chamado é reproduzido literalmente em nenhum lugar
  desta base; todo o conteúdo abaixo é generalizado e reescrito a partir de
  padrões observados em múltiplos chamados, nunca uma cópia de um caso
  específico.
- **Método**: as métricas da Fase 1 são calculadas sobre os 1.899 chamados
  completos. A taxonomia (Fase 2) vem diretamente dos campos do formulário de
  abertura do TomTicket (não é inferida por texto). As árvores de decisão e
  FAQs (Fases 3-6) foram construídas a partir de amostras representativas
  lidas por categoria (as de maior volume com mais amostras), não da leitura
  de todos os 1.899 chamados individualmente — é uma síntese de padrões, não
  uma transcrição.
- **Prioridade e "problema resolvido"**: quase todos os chamados (1.898/1.899)
  estão marcados como prioridade "Baixa" no TomTicket, e o campo "problema
  resolvido" só foi preenchido em 150 chamados — por isso a Fase 1 usa
  "finalizado" (`Última Situação = Finalizada`) como proxy de conclusão, não
  esses dois campos.

## Fase 1 — Relatório quantitativo

- **Total de chamados analisados**: 1.899
- **Categorias distintas**: 25
- **% finalizados**: 92,8%
- **% com pelo menos uma interação de atendente**: 97,6% (o restante são
  chamados só de anexo/comprovante sem necessidade de resposta, ou ainda sem
  atendente vinculado)
- **Tempo médio de resolução (criação → finalização)**: 132,6 horas corridas
- **Tempo médio até a primeira resposta**: 70,8 horas corridas

### Volume e tempos por categoria

<!-- prettier-ignore -->
| Categoria | Volume | % do total | Finalizados | Tempo médio de resolução | Tempo médio de 1ª resposta |
|---|---:|---:|---:|---:|---:|
| Auxílio Creche | 326 | 17,2% | 309 | 254h | 168h |
| Dúvidas de Vale Transporte | 209 | 11,0% | 205 | 109h | 47h |
| Portal ADP | 190 | 10,0% | 190 | 57h | 42h |
| Atualização Cadastral | 172 | 9,1% | 133 | 215h | 127h |
| Plano de Saúde | 138 | 7,3% | 124 | 95h | 46h |
| Folha de Pagamento | 112 | 5,9% | 103 | 89h | 65h |
| Vale Refeição | 94 | 4,9% | 92 | 120h | 61h |
| Alteração de Vale Transporte | 94 | 4,9% | 92 | 123h | 60h |
| Vale Alimentação | 77 | 4,1% | 76 | 104h | 66h |
| Plano Odontológico | 66 | 3,5% | 57 | 113h | 47h |
| Ponto | 61 | 3,2% | 59 | 48h | 39h |
| 2ª Via de Crachá | 61 | 3,2% | 55 | 106h | 23h |
| Renúncia de Vale Transporte | 61 | 3,2% | 61 | 67h | 47h |
| Declarações | 48 | 2,5% | 38 | 91h | 53h |
| Contracheques | 38 | 2,0% | 34 | 104h | 59h |
| Gympass | 30 | 1,6% | 25 | 100h | 60h |
| Convênios e Parcerias | 30 | 1,6% | 27 | 68h | 49h |
| TotalPass | 30 | 1,6% | 27 | 174h | 102h |
| Empréstimo Consignado | 23 | 1,2% | 21 | 181h | 196h |
| Férias | 21 | 1,1% | 21 | 105h | 105h |
| 2ª Via VT — Rio Card | 7 | 0,4% | 7 | 56h | 11h |
| Cadastro de Conta Bradesco | 5 | 0,3% | 3 | 73h | 29h |
| Convenção Coletiva | 3 | 0,2% | 3 | 39h | 39h |
| Telemedicina Conexa | 2 | 0,1% | 1 | 318h | 198h |
| Seguro de Vida | 1 | 0,1% | 0 | — | 76h |

**Leituras principais:**

- **Auxílio Creche é o maior volume (17%) mas é o mais simples de automatizar**:
  a grande maioria são só envios de comprovante mensal ("Recebido. Chamado
  finalizado."), não dúvidas de fato — mas tem o maior tempo médio de
  resolução (254h) porque frequentemente fica esperando o próximo ciclo de
  pagamento antes de ser encerrado, não porque é complexo.
- **Portal ADP concentra 10% do volume com uma causa única e recorrente** (a
  migração do sistema de login) e uma resposta praticamente roteirizada — é o
  melhor candidato a resposta automática de alta confiança pela IA, sem
  precisar de analista.
- **Atualização Cadastral tem o segundo maior tempo de resolução (215h) apesar
  de ser operacionalmente simples** — isso sugere fila/priorização, não
  complexidade do assunto.
- **Empréstimo Consignado e TotalPass têm tempo de 1ª resposta acima da
  média** (196h e 102h) — volume baixo, mas vale investigar se ficam
  represados atrás de outras filas.

## Fase 2 — Taxonomia

O TomTicket já expõe, por categoria, um campo específico do formulário de
abertura ("Chamado Externo") que funciona como subcategoria real — não uma
inferência de texto. As subcategorias com mais volume por categoria estão
listadas em cada arquivo de `infra/knowledge-base/departamento-pessoal/`.
Exemplos:

- **Auxílio Creche**: "Outros" (comprovante de rotina, 168), "Como faço para
  receber o benefício?" (33), "Não recebi o auxílio creche" (12).
- **Dúvidas de Vale Transporte**: "Meu VT mensal não foi depositado" (76),
  "Meu cartão não está realizando a integração" (12).
- **Portal ADP**: "Excedi as tentativas de acesso" (152), "Envio do link para
  redefinição" (38).
- **Plano de Saúde / Odontológico**: "Inclusão de Dependentes" e "Exclusão de
  Dependentes" concentram a maior parte além de "Outros".
- **Folha de Pagamento**: "Meu pagamento veio errado" (40), "Identifiquei um
  desconto indevido" (34).

## Fase 3 e 4 — Árvores de decisão e base estruturada para RAG

Para cada uma das 25 categorias, `infra/knowledge-base/departamento-pessoal/`
contém um arquivo `.txt` com: resumo, causas mais comuns, checklist de
verificação (o que o analista confere antes de responder), a orientação
típica e, quando aplicável, FAQs. Esses arquivos são lidos automaticamente
pela sincronização (local ou Drive) — nenhuma ação manual é necessária além
de já estarem no repositório.

Três padrões investigativos se repetem entre várias categorias e vale
destacar (também refletidos no prompt da IA, Fase 6):

1. **Datas de corte determinam a competência.** Vale Transporte, VR/VA e
   suas alterações/renúncias têm um corte mensal (dia 15) — pedidos depois
   disso só valem na competência seguinte. Isso explica boa parte das dúvidas
   de "por que não caiu ainda".
2. **Elegibilidade por janela de tempo.** Inclusão de dependente em Plano de
   Saúde e Odontológico só é permitida na ativação do titular ou em até 30
   dias de um evento elegível (nascimento, casamento) — fora disso, a
   resposta é sempre negativa e não depende de mais investigação.
3. **Valores "errados" costumam ser composição de eventos, não erro.** Em
   Folha de Pagamento e Férias, boa parte das dúvidas se resolve mostrando a
   composição de eventos do contracheque (ex.: desconto de atestado somado ao
   salário base) em vez de uma correção de fato.

## Fase 5 — FAQs

23 perguntas frequentes generalizadas (sem texto literal de nenhum chamado)
foram extraídas e estão em `backend/scripts/seed_faqs_from_tomticket.py`,
prontas para popular a tabela de FAQs — ver "Como usar" abaixo.

## Fase 6 — Prompt de atendimento da IA

O prompt do modelo (`SYSTEM_PROMPT` em `backend/app/services/ai_providers.py`)
passou a incluir esta instrução, para que a IA raciocine como um analista de
DP em vez de responder de forma absoluta quando o caso depende de dados
específicos:

> Raciocine como um analista experiente de Departamento Pessoal, não como uma
> tabela de respostas prontas. Muitos temas de DP (pagamento, benefícios,
> ponto) dependem de dados específicos do caso (datas, competência, cargo,
> histórico) que a pergunta sozinha não traz — nesses casos, não afirme uma
> conclusão absoluta. Em vez disso: identifique o assunto, explique em poucas
> palavras o que normalmente precisa ser conferido para esse tipo de caso (a
> mesma verificação que um analista faria) e peça ao colaborador as
> informações que faltam para concluir a análise. Só afirme algo com certeza
> quando o CONTEXTO já contiver o dado específico necessário (política,
> prazo, regra) para a pergunta feita.

Exemplo do comportamento esperado (não uma resposta fixa — o modelo formula
a pergunta de verificação de acordo com o caso real):

- **Pergunta**: "Meu vale refeição veio com valor errado."
- **Antes**: risco de responder algo genérico ou impreciso sem dados do caso.
- **Depois**: a IA reconhece o assunto (Vale Refeição, ver árvore de decisão
  acima), explica que o valor pode variar por férias/afastamento/mudança de
  escala/cargo no mês, e pergunta se algo disso ocorreu no período — só então
  orienta a próxima etapa (abrir chamado se o analista precisar confirmar com
  dados internos, ou responder direto se a resposta já está clara).

## Fase 7 — Pacote consolidado

O "banco de conhecimento pronto" desta análise é a combinação de:

1. `infra/knowledge-base/departamento-pessoal/*.txt` — 25 arquivos, lidos
   automaticamente pela sincronização já configurada.
2. `backend/scripts/seed_faqs_from_tomticket.py` — 23 FAQs prontas (opcional).
3. O `SYSTEM_PROMPT` atualizado em `ai_providers.py` — já em produção assim
   que o backend for reiniciado, sem nenhuma ação adicional.
4. Este documento, como registro da metodologia e das decisões de anonimização.

### Como usar

Os arquivos `.txt` já sincronizam sozinhos (nenhuma ação necessária). Para
também carregar as FAQs na base:

```bash
cd backend
python -m scripts.seed_faqs_from_tomticket
```

Isso requer que o provedor de embeddings (`EMBEDDING_PROVIDER`) já esteja
configurado, pois cada FAQ é indexada no Qdrant no momento da criação — o
mesmo requisito de qualquer outro conteúdo da base de conhecimento.
