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
- **IA**: Claude via Anthropic, OpenAI, ou Amazon Bedrock — provedor configurável via variável de ambiente.
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
│   ├── k8s/            # Manifests Kubernetes
│   └── aws/            # Terraform — deploy na AWS (ECS Fargate)
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
  - `60%–85%` → resposta + sugestão de abertura de chamado (colaborador confirma).
  - `< 60%` → IA não tem resposta segura + sugestão de abertura de chamado (colaborador confirma).

  A IA nunca abre um chamado sozinha — em qualquer faixa abaixo de 85%, a
  abertura depende de confirmação explícita do colaborador.

## Sincronização com pasta local/de rede

A base de conhecimento fica sincronizada automaticamente com uma pasta local
ou de rede montada no servidor — **100% local, sem custo e sem nenhuma API
externa**. Basta atualizar (ou adicionar) um arquivo `.txt`/`.pdf` na pasta
que a próxima pergunta no chat já reingere a versão nova, sem subir nada
manualmente pelo painel. Configuração via `LOCAL_KNOWLEDGE_FOLDER` (ver
`.env.example`); detalhes de funcionamento em `docs/ARCHITECTURE.md` (seção
4.1). Também dá para forçar uma sincronização imediata via
`POST /knowledge/documents/sync-local` (admin).

Passo a passo completo para habilitar (montar a pasta de rede localmente ou
no Kubernetes): `docs/LOCAL_KNOWLEDGE_SETUP.md`.

Alternativa (ou complemento) quando não existe uma pasta de rede real, mas o
conteúdo já mora numa pasta do Google Drive: sincronização direto pela API do
Drive via service account, sem depender do computador de ninguém — passo a
passo em `docs/GOOGLE_DRIVE_SETUP.md`.

A base de conhecimento já vem com 25 arquivos derivados da análise do
histórico de chamados do TomTicket (`infra/knowledge-base/departamento-pessoal/`),
prontos para uso — ver `docs/TOMTICKET_KNOWLEDGE_BASE.md` para a metodologia
completa (relatório, taxonomia, árvores de decisão e FAQs).

## Deploy em produção

- **AWS (ECS Fargate)**: Terraform pronto em `infra/aws/` — VPC, RDS,
  ElastiCache, EFS, S3, Qdrant self-hosted e Amazon Bedrock para o Claude
  (sem chave de API separada). Passo a passo completo, do zero (incluindo
  pedir acesso ao modelo no Bedrock): `docs/AWS_DEPLOYMENT.md`.
- **Kubernetes**: manifests em `infra/k8s/` — ver `infra/k8s/README.md`.
