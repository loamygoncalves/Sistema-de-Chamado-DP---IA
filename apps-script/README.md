# BEEP AI Service Desk — protótipo em Google Apps Script

Versão simplificada do sistema real (que é FastAPI + PostgreSQL + Next.js +
Celery + S3) rodando inteiramente dentro do Google Workspace: a própria
planilha faz o papel de banco de dados, `HtmlService` serve a tela, e
`MailApp` envia as notificações. Sem servidor próprio, sem infraestrutura
para manter — só uma cópia da planilha e um deploy de app da Web.

## O que este protótipo tem

- **Chat com IA própria, sem custo e sem nuvem externa** (`TextMatch.gs` +
  `AiService.gs`): nada sai do Google Workspace e nada vem da internet — a
  IA só sabe o que está escrito na aba `FAQs`. Ela entende o colaborador
  mesmo quando ele escreve errado ou informal, porque combina quatro
  camadas: correção de digitação (distância de edição contra o vocabulário
  real da base), dicionário de sinônimos do DP ("holerite" → contracheque,
  "VR" → vale refeição, "convênio" → plano de saúde), stemming leve
  (plural/sufixo deixam de atrapalhar) e ranqueamento BM25 com IDF. Além
  disso: tem memória de conversa (acompanhamento como "e se eu for
  plantonista?" herda o assunto anterior), **pergunta em vez de chutar**
  quando dois assuntos empatam, e o colaborador pode clicar em "Encerrar
  conversa" para mudar de assunto do zero.
- Abertura de chamado guiada: nome/matrícula pré-preenchidos, escolha da
  fila, resumo do caso montado a partir da conversa para o analista, e
  anexo de arquivo (guardado no Google Drive).
- Fila do analista com caixa de entrada geral, aba "Meus atendimentos",
  busca e filtros de atrasados / pendente interação do analista.
- Status automático: nasce em "Em triagem", vira "Em atendimento" ao ser
  assumido/atribuído, volta pra triagem se o responsável for removido.
- Transferência de chamado (analista + fila + motivo) e respostas padrão
  (genéricas ou por fila), com atalho de inserção com um clique.
- Encerramento com motivo obrigatório, notificações por e-mail (aberto /
  respondido / finalizado) e um dashboard bem simples.

## Passo a passo com imagens (aba `Passos`)

Um FAQ pode ter um passo a passo ilustrado — texto **e** print de cada
etapa, como o guia de primeiro acesso ao ADP. As etapas ficam na aba
`Passos`, uma linha por etapa:

| Pergunta | Ordem | Titulo | Texto | Imagem |
|---|---|---|---|---|
| Como faço o primeiro acesso ao portal ADP eXpert? | 1 | Acesse o link | Clique no link exclusivo... | *(link do Drive)* |
| Como faço o primeiro acesso ao portal ADP eXpert? | 2 | Preencha seus dados... | Informe Nome, Sobrenome... | *(link do Drive)* |

- **`Pergunta`** precisa ser **idêntica** à da aba `FAQs` — é o que liga a
  etapa ao FAQ.
- **`Imagem`** aceita o link do Drive como ele vier (`/file/d/ID/view`,
  `open?id=...`) ou só o ID; o sistema extrai o ID sozinho.
- Etapa **sem** imagem funciona normalmente — vale pelo texto.

Como adicionar um passo a passo novo:
1. Suba os prints numa pasta do Drive e compartilhe cada print (ou a
   pasta) como **"Qualquer pessoa com o link" — Leitor**. Não precisa
   compartilhar com uma conta específica, só ligar esse compartilhamento
   por link (o arquivo continua fora de busca/indexação — só quem tem o
   link ou o ID consegue abrir).
2. Crie o FAQ na aba `FAQs`, com um resumo curto na `Resposta`.
3. Crie uma linha por etapa na aba `Passos`, colando o link do print.

**Escreva o passo a passo em texto também, não só na imagem** — é o texto
que faz a IA encontrar o FAQ. Print sem texto vira conteúdo invisível
para a busca.

Dica: redimensione os prints para ~1000px de largura antes de subir. O
sistema entrega a imagem embutida (o próprio script busca o link e
devolve como data URI) — o colaborador nunca vê o link do Drive nem
precisa de conta para abri-lo, mas o arquivo em si passa a depender do
compartilhamento por link, não fica 100% privado como uma leitura direta
via Drive exigiria. Optamos por esse caminho porque a leitura direta
(`DriveApp.getFileById`) pede um escopo de Drive que só a conta que fez o
deploy consegue autorizar — o link público evita essa dependência.

## Acesso de colaboradores sem e-mail @beepsaude (aba `Colaboradores`)

Nem todo colaborador tem conta Google do domínio da empresa — só o time de
analistas tem, garantidamente. Por isso o deploy aceita **qualquer conta
Google** (não só do domínio — ver `webapp.access` no `appsscript.json`), e
quem não tem e-mail cadastrado precisa confirmar a identidade por
matrícula, contra a aba `Colaboradores`:

| Matricula | Nome | Email | Filial | DataAdmissao | Celular |
|---|---|---|---|---|---|
| 12345 | Maria Silva | maria.silva@beepsaude.com.br | Hub São Paulo | 2024-03-01 | 11999999999 |

Como manter essa aba:
1. Tire da ADP o relatório de **colaboradores ativos** (Matrícula, Nome,
   E-mail, Filial/"Nome Fantasia", Data de admissão, Celular).
2. Selecione as linhas de dado da aba `Colaboradores` (tudo abaixo do
   cabeçalho) e apague.
3. Cole o relatório novo por cima, mantendo o cabeçalho da linha 1.

Como o relatório traz **só quem está ativo**, colar por cima (substituição
completa) já resolve o desligamento sozinho: quem saiu da empresa some da
aba no próximo import e, na tentativa seguinte de acessar, nem o e-mail
nem a matrícula salva batem mais — a pessoa é barrada.

Como funciona a identificação, na prática:
- **E-mail bate com a aba** (comum pra quem tem Gmail/Workspace cadastrado
  na ADP igual ao que usa pra entrar) → reconhecido na hora, sem digitar
  nada.
- **E-mail não bate** (e-mail cadastrado não é Google, ou a pessoa entrou
  com outro Gmail) → aparece uma tela pedindo a **matrícula**; confirmada
  uma vez contra a aba `Colaboradores`, fica lembrada nas próximas visitas
  (por conta Google, como o nome/matrícula do formulário de chamado).

## Atualizando a base depois de uma mudança

Quando uma atualização trouxer conteúdo novo (FAQs, etapas), rode
`initializeSpreadsheet` de novo — é aditivo: insere só o que falta, não
duplica nada e não apaga links de imagem já preenchidos.

Dá para fazer sem abrir o editor, pelo navegador, com as rotas de
administração do app (funcionam para o **dono** da implantação e para
qualquer **analista ativo** da aba `Analistas`; para qualquer outra conta o
parâmetro é ignorado):

- `.../exec?admin=setup` — atualiza a base e devolve um resumo.
- `.../exec?admin=imagens&faq=<pergunta>&ids=<id1,id2,...>` — preenche a
  coluna `Imagem` das etapas daquele FAQ, na ordem.

## O que este protótipo NÃO tem (limitações do Apps Script)

- **Não é um modelo de linguagem (LLM)** — a IA não *gera* texto novo: ela
  entende a pergunta e entrega o conteúdo que está na base, com uma
  abertura que reconhece o assunto. Ela nunca inventa valor, prazo ou
  regra que não esteja escrito na aba `FAQs` — o que é exatamente a
  garantia que se quer num sistema de DP, mas significa que ela não
  redige explicações originais nem raciocina sobre casos novos.
- **A qualidade depende da base** — como ela só sabe o que está na aba
  `FAQs`, a forma de deixá-la mais inteligente é adicionar FAQs (e
  sinônimos novos em `SYNONYMS_`, no `TextMatch.gs`), não trocar de
  algoritmo. Quando um chamado revelar uma dúvida recorrente que a base
  não cobria, vale virar um FAQ novo.
- **Sem RAG vetorial** — a recuperação é léxica (palavras), não por
  embeddings. Funciona bem para uma base de dezenas/centenas de FAQs, mas
  não escala como o RAG do backend real.
- **Sem fila assíncrona** — tudo roda de forma síncrona na mesma execução
  (limite de 6 minutos por chamada do Apps Script).
- **SLA simplificado** — pula sábado/domingo, mas não feriados nacionais
  (o backend real usa um calendário de feriados).
- **Identidade = conta Google** — não há tela de login/senha própria; quem
  abre o link usa a própria conta Google (pode ser pessoal, já que nem
  todo colaborador tem e-mail do domínio). Quem não é reconhecido pelo
  e-mail confirma a matrícula contra a aba `Colaboradores` (ver seção
  acima) — essa aba é o controle de acesso de verdade, já que não dá pra
  desativar a conta Google de quem sai da empresa.
- Sem histórico de auditoria completo, sem avaliação de atendimento, sem
  base de conhecimento além de FAQs (sem ingestão de documentos).

Se o objetivo for produção de verdade, o sistema real (pasta `backend/` +
`frontend/`) é o caminho certo — isto aqui é para prototipar, validar com o
time ou rodar num piloto pequeno sem precisar de infraestrutura própria.

## Passo a passo de instalação

1. **Crie uma Planilha Google** nova (vazia) — ela vai servir de banco de
   dados. Dê um nome como "BEEP Service Desk — Dados".
2. Nela, abra **Extensões > Apps Script**.
3. Apague o `Code.gs` de exemplo e cole o conteúdo de cada arquivo desta
   pasta como um arquivo de mesmo nome no projeto:
   - `Code.gs`, `SheetService.gs`, `TextMatch.gs`, `AiService.gs`, `EmailService.gs`, `Setup.gs`
   - `Index.html`, `Styles.html`, `ClientScript.html` (crie como arquivos HTML,
     não `.gs` — use o "+" ao lado de "Arquivos" > HTML)
4. Em **Configurações do projeto** (ícone de engrenagem), marque **"Mostrar
   arquivo de manifesto 'appsscript.json' no editor"**. Abra o
   `appsscript.json` que aparecer e substitua o conteúdo pelo deste repositório.
5. Salve o projeto (ícone de disquete ou Ctrl/Cmd+S).
6. No editor, selecione a função `initializeSpreadsheet` no menu suspenso ao
   lado do botão "Executar" e clique em **Executar**. Na primeira vez o
   Google vai pedir para autorizar o script — aceite (é o próprio script
   acessando a própria planilha). Isso cria as abas e semeia os
   departamentos, FAQs e uma resposta padrão de exemplo.
   - Alternativamente, volte para a planilha, recarregue a página e use o
     menu **BEEP Service Desk > Inicializar planilhas (1x)** que aparece
     (via `onOpen`).
7. **Edite a aba "Analistas"** com os e-mails reais do time de DP (coluna
   `Email`, `Ativo = TRUE`). Quem estiver nessa lista vê a tela de analista
   ao abrir o link; quem não estiver vê a tela de colaborador.
8. **(Opcional)** Em **Configurações do projeto > Propriedades do script**:
   - `AUTO_THRESHOLD` / `SUGGEST_THRESHOLD` — de 0 a 1 (padrão `0.45` e
     `0.22`). Acima de `AUTO_THRESHOLD` a IA responde direto; entre os dois
     ela responde com ressalva e oferece chamado; abaixo do menor ela não
     arrisca e vai direto para o chamado. **Suba** o `AUTO_THRESHOLD` se
     ela estiver respondendo com confiança demais; **desça** se estiver
     mandando para chamado coisas que a base já responde.
   - `EMAIL_NOTIFICATIONS_ENABLED` — defina como `false` para desligar os
     e-mails (por padrão estão ligados).
9. **Implante como app da Web**: no editor, **Implantar > Nova implantação**
   > tipo "App da Web". Configure:
   - **Executar como**: Eu (sua conta)
   - **Quem pode acessar**: **"Qualquer pessoa"** — precisa ser essa opção
     (não "Qualquer pessoa no domínio"), já que nem todo colaborador tem
     e-mail `@beepsaude.com.br`. Isso ainda exige estar logado em alguma
     conta Google (não é "qualquer pessoa, até anônimo"); quem não é
     reconhecido pelo e-mail confirma a matrícula (ver aba `Colaboradores`
     acima). Esse campo já vem assim pelo `appsscript.json`, mas confira —
     ao editar uma implantação já existente pela interface, às vezes é
     preciso reafirmar a opção manualmente.
   - Copie a URL gerada e compartilhe com o time.

## Cota e limites a ter em mente

- **MailApp**: 100 e-mails/dia numa conta pessoal Gmail, 1.500/dia num
  Google Workspace normal. Para um piloto pequeno é suficiente.
- **UrlFetchApp** (chamadas à IA, se a chave estiver configurada): sujeitas
  às cotas normais de Apps Script (20.000 chamadas/dia num Workspace).
- **Planilha como banco**: funciona bem até a casa dos milhares de linhas;
  se o volume de chamados crescer muito, é sinal de que já vale migrar para
  o sistema real (`backend/` + `frontend/` deste repositório).

## Testando papéis diferentes

Como o papel (colaborador/analista) vem do e-mail da conta Google logada,
para testar a visão de analista use uma conta que esteja na aba
"Analistas"; para testar a visão de colaborador, use uma conta que não
esteja. Não existe alternância manual de papel nesta versão (ao contrário
do protótipo em HTML solto, que simula os dois lados numa página só).
