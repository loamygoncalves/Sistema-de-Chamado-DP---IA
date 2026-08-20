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
| POST | `/chat/conversations/{id}/messages` | Envia pergunta; retorna resposta da IA, score, fontes, e `ticket` se aberto automaticamente | employee+ |
| POST | `/chat/conversations/{id}/messages/{message_id}/open-ticket` | Converte sugestão em chamado (faixa 60–85%) | employee+ (dono) |

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
  "ticket": {"id": "uuid", "ticket_number": "BEEP-000123"}
}
```

## Tickets
| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| POST | `/tickets` | Abre chamado manualmente | employee+ |
| GET | `/tickets` | Lista com filtros (`status`, `department_id`, `priority`, `assigned_to`, `mine`) | employee+ (escopo próprio) / analyst+ (fila) |
| GET | `/tickets/{id}` | Detalhe + histórico | dono ou analyst+ |
| POST | `/tickets/{id}/comments` | Adiciona comentário | dono ou analyst+ |
| POST | `/tickets/{id}/attachments` | Upload de anexo | dono ou analyst+ |
| POST | `/tickets/{id}/assume` | Analista assume o chamado | analyst+ |
| POST | `/tickets/{id}/transfer` | Transfere para outro analista/fila | analyst+ |
| PATCH | `/tickets/{id}/priority` | Altera prioridade (recalcula SLA) | analyst+ |
| PATCH | `/tickets/{id}/status` | Altera status | analyst+ |
| POST | `/tickets/{id}/close` | Encerra chamado (dispara aprendizado contínuo) | analyst+ |
| POST | `/tickets/{id}/rating` | Colaborador avalia atendimento (1-5) | dono |

## Base de conhecimento
| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| GET | `/knowledge/articles` | Lista/pesquisa artigos | analyst+ |
| POST | `/knowledge/articles` | Cria artigo manual | analyst+ |
| GET | `/knowledge/faqs` | Lista FAQs | employee+ |
| POST | `/knowledge/faqs` | Cria FAQ | admin |
| POST | `/knowledge/documents` | Upload de documento (PDF/DOCX/XLSX/CSV/PPTX) para ingestão | admin |
| GET | `/knowledge/documents/{id}` | Status de indexação | admin |

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
| GET | `/dashboard/savings` | Economia estimada pela automação | admin |

`GET /dashboard/summary` retorna:
```json
{
  "total_atendimentos": 12450,
  "total_chamados": 2890,
  "taxa_resolucao_ia": 0.768,
  "taxa_abertura_chamado": 0.232,
  "sla_medio_horas": 6.4,
  "tempo_medio_resolucao_horas": 9.1,
  "nps_interno": 74,
  "economia_estimada_reais": 187650.0
}
```

## Auditoria
| Método | Rota | Descrição | Papéis |
|---|---|---|---|
| GET | `/audit-logs` | Consulta de logs de auditoria com filtros | admin |
