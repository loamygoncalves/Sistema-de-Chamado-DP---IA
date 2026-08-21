# Contrato de API REST — BEEP AI Service Desk

Base URL: `/api/v1`. Autenticação: `Authorization: Bearer <jwt>` (obtido via OIDC
login e troca de token no backend). Todas as respostas de erro seguem
`{"detail": "..."}` (padrão FastAPI/HTTPException).

## Auth
| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| GET | `/auth/login` | Redireciona para o IdP (Keycloak/Azure AD) | público |
| GET | `/auth/callback` | Callback OIDC, emite JWT interno + refresh cookie | público |
| POST | `/auth/refresh` | Renova access token | autenticado |
| POST | `/auth/logout` | Revoga refresh token | autenticado |
| GET | `/auth/me` | Perfil do usuário autenticado | autenticado |

## Chat / IA
| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| POST | `/chat/conversations` | Cria conversa | employee+ |
| GET | `/chat/conversations` | Lista conversas do usuário | employee+ |
| GET | `/chat/conversations/{id}` | Histórico de mensagens | employee+ (dono) |
| POST | `/chat/conversations/{id}/messages` | Envia pergunta; retorna resposta da IA, score e fontes. **Nunca abre chamado sozinho** — `ticket` vem sempre `null`. As últimas `CHAT_HISTORY_MAX_MESSAGES` mensagens da conversa são enviadas como memória ao LLM, para que perguntas de acompanhamento façam sentido. `409` se a conversa já estiver encerrada | employee+ |
| POST | `/chat/conversations/{id}/messages/{message_id}/feedback` | Registra se a resposta ajudou (`{"was_helpful": true|false}`). A pergunta é feita depois de **toda** resposta, inclusive as de alta confiança. `400` se a mensagem não for da IA | employee+ (dono) |
| POST | `/chat/conversations/{id}/messages/{message_id}/draft-ticket` | Pede à IA um resumo do contexto da conversa (`{"subject": "...", "description": "..."}`) para o colaborador revisar antes de confirmar — não cria nada, pode ser chamado quantas vezes precisar. Corpo: `{"department_id": "...", "category": "...", "subcategory": "..."}` | employee+ (dono) |
| POST | `/chat/conversations/{id}/messages/{message_id}/open-ticket` | Cria o chamado somente após confirmação explícita do colaborador. Corpo: `{"department_id": "...", "category": "...", "subcategory": "...", "subject": "...", "description": "..."}` — `subject`/`description` normalmente vêm do rascunho de `draft-ticket` (editável pelo colaborador antes de enviar); vazios, cai no resumo automático de pergunta+resposta | employee+ (dono) |
| POST | `/chat/conversations/{id}/close` | Encerra a conversa — a IA "esquece" o histórico dela; uma nova conversa (`POST /chat/conversations`) não carrega nenhuma memória desta | employee+ (dono) |

Resposta de `POST /messages`:
```json
{
  "message_id": "uuid",
  "answer": "texto da resposta",
  "confidence_score": 0.92,
  "decision": "auto_answer | suggest_ticket | auto_ticket",
  "sources": [
    {"type": "policy", "title": "Política de Home Office", "excerpt": "...", "id": "uuid"}
  ],
  "ticket": null
}
```

`decision` só informa a UI sobre qual mensagem mostrar — a abertura do chamado em
si é sempre uma ação separada e explícita do colaborador via `open-ticket`,
mesmo quando `decision` é `auto_ticket` (baixa confiança). Isso evita abrir um
chamado a cada pergunta que a IA não consiga responder com segurança.

### Sempre perguntar se a resposta ajudou

Depois de **qualquer** resposta da IA — inclusive as de alta confiança — a UI
pergunta "Isso resolveu sua dúvida?" e registra a escolha em
`POST .../feedback`. Só quem responde `was_helpful=false` recebe a pergunta
seguinte, "quer abrir um chamado para um analista do DP?", e só o `open-ticket`
depois disso cria o chamado. Assim a abertura do chamado passa a ser
consequência do colaborador dizer que não foi atendido, e não do score de
confiança da IA — o `decision` continua servindo apenas para a UI escolher o
texto que acompanha a resposta.

O feedback é opcional: `was_helpful` fica `null` enquanto o colaborador não
responde, porque "não respondeu" não é a mesma informação que "respondeu que
não ajudou". O valor pode ser trocado (reenviar o `POST` sobrescreve).

## Tickets
| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| POST | `/tickets` | Abre chamado manualmente. Nasce em `em_triagem` (caixa de entrada geral, sem analista). Dispara notificação por e-mail ao solicitante (evento `aberto`) | employee+ |
| GET | `/tickets` | Lista com filtros (`status`, `department_id`, `assigned_to`, `mine`, `q`, `unassigned`, `overdue`, `pending_analyst`). `q` busca por protocolo, matrícula, assunto ou nome do solicitante (usado pela aba de busca e por "meus atendimentos", que passa `assigned_to=<id do analista logado>`). `unassigned=true` é a **caixa de entrada geral** (`assigned_to IS NULL` — tela principal do analista); `overdue=true` filtra `sla_due_at` vencido e ainda não resolvido/encerrado; `pending_analyst=true` filtra chamados em `em_triagem`/`em_atendimento` (ainda não estão com `aguardando_usuário`, `resolvido` ou `encerrado`) | employee+ (escopo próprio) / analyst+ (fila) |
| GET | `/tickets/{id}` | Detalhe + histórico + anexos, com nomes já resolvidos (`requester_name`, `requester_email`, `assigned_to_name`, `department_name`, e `actor_name` em cada evento). **Notas internas são omitidas quando quem consulta é o solicitante** | dono ou analyst+ |
| POST | `/tickets/{id}/comments` | Adiciona mensagem à conversa. `{"comment": "...", "is_internal": false, "new_status": "aguardando_usuario"}` — `is_internal: true` grava **nota interna** (visível só a analyst+; a flag é ignorada se quem comenta é o solicitante); `new_status` muda o status na mesma ação (só analyst+, e **não** aceita `encerrado`). Resposta pública de analyst+ dispara notificação por e-mail ao solicitante (evento `respondido`) | dono ou analyst+ |
| POST | `/tickets/{id}/attachments` | Upload de anexo — persistido de verdade em armazenamento S3-compatível (MinIO local / S3 em produção, mesmas credenciais `S3_*`), não só os metadados | dono ou analyst+ |
| POST | `/tickets/{id}/assume` | Analista assume o chamado. Muda o status automaticamente para `em_atendimento` | analyst+ |
| POST | `/tickets/{id}/transfer` | Transfere para outro analista/fila. Status segue quem ficou responsável: com `assigned_to` definido vira `em_atendimento`; sem `assigned_to` (voltou pra caixa de entrada geral) volta a `em_triagem` | analyst+ |
| PATCH | `/tickets/{id}/priority` | Altera prioridade (recalcula SLA) | analyst+ |
| PATCH | `/tickets/{id}/status` | Altera status. **Não encerra**: `encerrado` retorna `400` — encerrar exige motivo e passa por `/close` | analyst+ |
| GET | `/tickets/closure-reasons` | Motivos de encerramento que **este** usuário pode usar, com a mensagem padrão de cada um (o texto mora no backend, para não haver duas cópias) | employee+ |
| POST | `/tickets/{id}/close` | Encerra o chamado. `{"reason": "...", "message": "..."}` — **`reason` é obrigatório** (`422` sem ele). `message` vazia usa a mensagem padrão do motivo. `409` se já estiver encerrado; `403` se o motivo não for permitido ao perfil. Dispara notificação por e-mail ao solicitante (evento `finalizado`). O aprendizado contínuo só dispara para `reason=resolvido` | dono (motivos do colaborador) ou analyst+ (motivos do DP) |
| POST | `/tickets/{id}/rating` | Colaborador avalia atendimento (1-5) | dono |
| GET | `/tickets/canned-responses` | Lista respostas padrão. Sem `department_id`, devolve todas; com `department_id`, devolve as genéricas (sem fila) + as da fila | analyst+ |
| POST | `/tickets/canned-responses` | Cria resposta padrão. `{"title": "...", "content": "...", "department_id": null}` — `department_id` nulo torna a resposta genérica (disponível em qualquer fila) | analyst+ |
| DELETE | `/tickets/canned-responses/{id}` | Remove resposta padrão | analyst+ |

### Ciclo de status automático
O status do chamado segue o responsável, sem ação manual do analista: `em_triagem` (recém-aberto, na caixa de entrada geral) → `em_atendimento` (assim que alguém assume ou é atribuído via transferência) → `em_triagem` de novo se a transferência remover o responsável (`assigned_to=null`, volta pra caixa de entrada). As transições para `aguardando_usuario`/`encerrado` continuam manuais (via `/comments` com `new_status`, `/status` ou `/close`).

## Base de conhecimento
| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| GET | `/knowledge/articles` | Lista/pesquisa artigos | analyst+ |
| POST | `/knowledge/articles` | Cria artigo manual | analyst+ |
| GET | `/knowledge/faqs` | Lista FAQs | employee+ |
| POST | `/knowledge/faqs` | Cria FAQ | admin |
| POST | `/knowledge/documents` | Upload de documento (PDF/DOCX/XLSX/CSV/PPTX/TXT) para ingestão | admin |
| GET | `/knowledge/documents/{id}` | Status de indexação | admin |
| POST | `/knowledge/documents/sync-local` | Dispara sob demanda a sincronização com a pasta local/de rede configurada (`LOCAL_KNOWLEDGE_FOLDER`). Retorna `{created, updated, skipped_unchanged, skipped_unsupported, errors}` (caminhos dos arquivos em cada lista, relativos à pasta). `400` se `LOCAL_KNOWLEDGE_FOLDER` não estiver configurado ou não existir | admin |
| POST | `/knowledge/documents/sync-drive` | Dispara sob demanda a sincronização com a pasta do Google Drive configurada (`GOOGLE_DRIVE_FOLDER_ID` + `GOOGLE_SERVICE_ACCOUNT_JSON`, ver `docs/GOOGLE_DRIVE_SETUP.md`). Mesmo formato de resposta do `sync-local`. `400` se não configurado ou se a pasta não tiver sido compartilhada com a service account | admin |

A mesma sincronização também roda automaticamente no início de cada resposta
da IA (`POST /chat/conversations/{id}/messages`) — ver `docs/ARCHITECTURE.md`.

## Departamentos
| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| GET | `/departments` | Lista filas | employee+ |
| POST | `/departments` | Cria fila | admin |
| PATCH | `/departments/{id}` | Atualiza fila (SLA padrão etc.) | admin |

## Configuração de IA
| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| GET | `/settings/ai` | Thresholds e provedor atual | admin |
| PATCH | `/settings/ai` | Atualiza thresholds/provedor/modelo | admin |

## Dashboard
| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| GET | `/dashboard/summary` | KPIs agregados (período via `?from=&to=`) | department_lead+ |
| GET | `/dashboard/by-department` | Chamados e taxa de resolução por área | department_lead+ |
| GET | `/dashboard/sla` | SLA médio e tempo médio de resolução | department_lead+ |

`GET /dashboard/summary` retorna:
```json
{
  "total_atendimentos": 12450,
  "total_chamados": 2890,
  "taxa_resolucao_ia": 0.768,
  "taxa_abertura_chamado": 0.232,
  "sla_medio_horas": 6.4,
  "tempo_medio_resolucao_horas": 9.1
}
```

NPS e economia estimada pela automação foram removidos do dashboard por enquanto
— não havia metodologia validada por trás desses dois números (NPS dependia de
poucas avaliações reais de chamados; a economia usava um custo médio por
atendimento assumido, não calibrado com dados da Beep). Podem voltar quando
houver uma base de cálculo confiável.

## Auditoria
| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| GET | `/audit-logs` | Consulta de logs de auditoria com filtros | admin |
