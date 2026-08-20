# BEEP AI Service Desk

Central de Atendimento Inteligente para colaboradores da BEEP Saúde — responde dúvidas
automaticamente via IA (RAG), e abre chamados apenas quando a IA não tem confiança
suficiente na resposta.

Host alvo: `https://operacoes-playground.internal.beepsaude.com.br`

## Visão geral

- **Frontend**: Next.js 14 (App Router) + React + Tailwind — portal do colaborador,
  portal de chamados, portal do analista e dashboard gerencial.
- **Backend**: Python 3.11 + FastAPI — API REST, orquestração de RAG, motor de tickets,
  aprendizado contínuo.
- **Banco de dados**: PostgreSQL 16.
- **Cache / filas**: Redis (cache + broker do Celery).
- **Vetorização**: Qdrant.
- **IA**: Claude (Anthropic) e OpenAI, com provedor configurável via variável de ambiente.
- **Autenticação**: OIDC (Keycloak ou Azure AD) + JWT interno + RBAC.

Consulte `docs/ARCHITECTURE.md` para a arquitetura completa, `docs/DATABASE.md` para o
schema do banco e `docs/API.md` para o contrato da API REST.

## Estrutura do repositório

```
.
├── backend/            # API FastAPI, RAG, workers Celery
├── frontend/           # Next.js — portais e dashboard
├── infra/
│   ├── docker-compose.yml
│   └── k8s/            # Manifests Kubernetes
├── .github/workflows/  # Pipeline CI/CD
└── docs/               # Arquitetura, banco de dados, API
```

## Rodando localmente

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

- Frontend: http://localhost:3000
- Backend (Swagger): http://localhost:8000/docs
- Qdrant: http://localhost:6333/dashboard
- Keycloak: http://localhost:8080 (realm `beep` já importado, veja `infra/keycloak/realm-export.json`)

O Keycloak sobe com um realm `beep` pré-configurado e três usuários de teste
(senha `beep123`): `colaborador.demo`, `analista.demo`, `admin.demo`. Depois que os
containers estiverem de pé, popule dados de exemplo (FAQs, chamado de exemplo) com:

```bash
docker compose -f infra/docker-compose.yml exec backend python -m scripts.seed_demo_data
```

O script é idempotente e os ids dos usuários de demonstração já correspondem aos
`sub` do Keycloak, então o primeiro login via SSO reaproveita esses registros em
vez de criar duplicados.

## Metas do produto

- Atender > 10.000 solicitações/mês.
- Reduzir em pelo menos 70% a abertura de chamados via automação por IA.
- Roteamento por confiança da resposta (thresholds parametrizáveis):
  - `> 85%` → resposta automática.
  - `60%–85%` → resposta + sugestão de abertura de chamado.
  - `< 60%` → abertura automática de chamado.
