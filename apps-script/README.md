# BEEP AI Service Desk — protótipo em Google Apps Script

Versão simplificada do sistema real (que é FastAPI + PostgreSQL + Next.js +
Celery + S3) rodando inteiramente dentro do Google Workspace: a própria
planilha faz o papel de banco de dados, `HtmlService` serve a tela, e
`MailApp` envia as notificações. Sem servidor próprio, sem infraestrutura
para manter — só uma cópia da planilha e um deploy de app da Web.

## O que este protótipo tem

- Chat com IA (casador léxico de FAQs, igual ao motor de decisão do sistema
  real) com memória de conversa de verdade — perguntas de acompanhamento
  ("e isso muda se eu for autônomo?") levam em conta o que já foi dito,
  até o colaborador clicar em "Encerrar conversa" para começar do zero em
  outro assunto — e abertura de chamado guiada: nome/matrícula
  pré-preenchidos, escolha da fila, resumo do caso escrito pela IA para o
  analista confirmar, e anexo de arquivo (guardado no Google Drive).
- Fila do analista com caixa de entrada geral, aba "Meus atendimentos",
  busca e filtros de atrasados / pendente interação do analista.
- Status automático: nasce em "Em triagem", vira "Em atendimento" ao ser
  assumido/atribuído, volta pra triagem se o responsável for removido.
- Transferência de chamado (analista + fila + motivo) e respostas padrão
  (genéricas ou por fila), com atalho de inserção com um clique.
- Encerramento com motivo obrigatório, notificações por e-mail (aberto /
  respondido / finalizado) e um dashboard bem simples.

## O que este protótipo NÃO tem (limitações do Apps Script)

- **Sem RAG vetorial** — a recuperação de FAQ é por casamento de palavras
  (léxico), não por embeddings. Funciona bem para uma base pequena de FAQs,
  mas não escala como o RAG do backend real.
- **Sem fila assíncrona** — tudo roda de forma síncrona na mesma execução
  (limite de 6 minutos por chamada do Apps Script).
- **SLA simplificado** — pula sábado/domingo, mas não feriados nacionais
  (o backend real usa um calendário de feriados).
- **Identidade = conta Google** — não há tela de login própria; quem abre o
  link usa a própria conta Google. Por isso o deploy recomendado é para o
  domínio da empresa, não público.
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
   - `Code.gs`, `SheetService.gs`, `AiService.gs`, `EmailService.gs`, `Setup.gs`
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
8. **(Opcional, mas recomendado)** Em **Configurações do projeto >
   Propriedades do script**, adicione:
   - `ANTHROPIC_API_KEY` — sua chave da API da Anthropic (usa o modelo
     `claude-opus-5`; para trocar o modelo, edite `callClaude_` em
     `AiService.gs`). Sem a chave, o protótipo continua funcionando, só que
     as respostas da IA e o resumo do chamado ficam mais literais (direto do
     FAQ / template simples) em vez de
     escritos por um modelo de linguagem de verdade.
   - `AUTO_THRESHOLD` / `SUGGEST_THRESHOLD` — opcionais, de 0 a 1, para
     ajustar os limiares de confiança (padrão 0.85 / 0.60, iguais ao sistema
     real).
   - `EMAIL_NOTIFICATIONS_ENABLED` — defina como `false` para desligar os
     e-mails (por padrão estão ligados).
9. **Implante como app da Web**: no editor, **Implantar > Nova implantação**
   > tipo "App da Web". Configure:
   - **Executar como**: Eu (sua conta)
   - **Quem pode acessar**: "Qualquer pessoa em [seu domínio Google
     Workspace]" — não use "Qualquer pessoa" (público), pois a identificação
     de quem está usando depende de estar logado numa conta do domínio.
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
