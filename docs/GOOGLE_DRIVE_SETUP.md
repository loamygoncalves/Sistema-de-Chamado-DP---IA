# Configurar a sincronização automática com o Google Drive

Guia passo a passo para habilitar a sincronização automática da base de
conhecimento com a pasta do Google Drive `SISTEMA DE CHAMADO - IA`
(`https://drive.google.com/drive/folders/18EaKrwmBOTLZ1bKQ-_iC_F7_sUM6CB65`).

O código já está pronto (`app/services/drive_sync_service.py` + Celery Beat +
`POST /knowledge/documents/sync-drive`) — falta apenas quem tiver acesso ao
Google Cloud/Workspace da Beep executar os passos abaixo. Depois disso, basta
editar/adicionar arquivos na pasta do Drive que o sistema reingere sozinho
(a cada `DRIVE_SYNC_INTERVAL_MINUTES`, padrão 15 min).

## 1. Criar (ou reaproveitar) um projeto no Google Cloud

1. Acesse https://console.cloud.google.com/ com uma conta com permissão na
   organização Google Workspace da Beep.
2. Crie um projeto novo (ex.: `beep-service-desk-ia`) ou use um projeto já
   existente aprovado para uso interno.

## 2. Ativar a Google Drive API

1. No projeto, vá em **APIs e serviços → Biblioteca**.
2. Busque **Google Drive API** e clique em **Ativar**.

## 3. Criar a conta de serviço

1. Vá em **APIs e serviços → Credenciais → Criar credenciais → Conta de
   serviço**.
2. Nome sugerido: `beep-drive-sync`. Não precisa conceder papéis do projeto
   (o acesso à pasta é dado diretamente no Drive, no passo 4).
3. Após criar, abra a conta de serviço → aba **Chaves → Adicionar chave →
   Criar nova chave → JSON**. Isso baixa um arquivo `.json` — **trate como
   segredo** (não commitar no Git, não enviar por e-mail/Slack sem
   criptografia).
4. Anote o campo `client_email` dentro do JSON (algo como
   `beep-drive-sync@beep-service-desk-ia.iam.gserviceaccount.com`) — é esse
   e-mail que precisa ser compartilhado com a pasta no passo seguinte.

## 4. Compartilhar a pasta do Drive com a conta de serviço

1. Abra a pasta `SISTEMA DE CHAMADO - IA` no Drive (é preciso ter acesso de
   edição/compartilhamento a ela — se ninguém do time tem, peça a quem
   criou a pasta para adicionar você primeiro, ou peça diretamente a
   inclusão do e-mail da conta de serviço).
2. Clique em **Compartilhar** → cole o `client_email` da conta de serviço →
   papel **Leitor** → Enviar.

   A conta de serviço não tem e-mail de login humano nem recebe
   notificação visível — apenas confirme que ela aparece na lista de
   pessoas com acesso à pasta.

## 5. Configurar o servidor

No arquivo `.env` (produção: ConfigMap/Secret do Kubernetes — ver
`infra/k8s/01-configmap.yaml` e `infra/k8s/02-secrets.example.yaml`):

```bash
GOOGLE_DRIVE_SYNC_ENABLED=true
GOOGLE_DRIVE_FOLDER_ID=18EaKrwmBOTLZ1bKQ-_iC_F7_sUM6CB65
GOOGLE_SERVICE_ACCOUNT_FILE=/etc/google/service-account.json
GOOGLE_DRIVE_DEFAULT_DEPARTMENT_SLUG=
DRIVE_SYNC_INTERVAL_MINUTES=15
```

- `GOOGLE_SERVICE_ACCOUNT_FILE` deve apontar para o caminho onde o JSON da
  conta de serviço fica montado no container (em Kubernetes, isso já é
  feito automaticamente pelo volume `google-drive-credentials` em
  `infra/k8s/22-worker.yaml` — só é preciso preencher o Secret
  `beep-google-drive-secrets` com o conteúdo real do JSON).
- `GOOGLE_DRIVE_DEFAULT_DEPARTMENT_SLUG` pode ficar vazio: os documentos da
  pasta (ex.: Guia do Colaborador) cobrem vários assuntos e ficam
  disponíveis para a IA independente de departamento. Preencha apenas se
  quiser associar tudo da pasta a uma fila específica (ex.:
  `folha-de-pagamento`).
- Em Docker Compose local, adicione as mesmas variáveis ao `.env` e monte o
  JSON como volume no serviço `worker`/`beat` (ex.:
  `./google-service-account.json:/etc/google/service-account.json:ro`).

## 6. Reiniciar/aplicar e testar

- **Docker Compose**: `docker compose -f infra/docker-compose.yml up -d --build worker beat`
- **Kubernetes**: `kubectl apply -f infra/k8s/01-configmap.yaml infra/k8s/02-secrets.example.yaml infra/k8s/22-worker.yaml infra/k8s/24-beat.yaml`

Para testar sem esperar o ciclo do Beat, chame o endpoint sob demanda (papel
admin):

```bash
curl -X POST https://operacoes-playground.internal.beepsaude.com.br/api/v1/knowledge/documents/sync-drive \
  -H "Authorization: Bearer <token-admin>"
```

A resposta traz `{created, updated, skipped_unchanged, skipped_unsupported,
errors}` com o nome de cada arquivo processado. Se `GOOGLE_DRIVE_FOLDER_ID`
ou `GOOGLE_SERVICE_ACCOUNT_FILE` não estiverem configurados, retorna `400`
explicando o que falta.

## Depois de configurado

Basta editar/atualizar o arquivo diretamente na pasta do Drive — o próximo
ciclo do Celery Beat (ou uma chamada manual ao endpoint acima) detecta a
mudança pelo `modifiedTime` e reingere o conteúdo automaticamente, sem
necessidade de subir nada manualmente pelo painel do sistema.
