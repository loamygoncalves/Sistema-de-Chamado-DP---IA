# Configurar a sincronização com uma pasta do Google Drive

Alternativa (ou complemento) à pasta local/de rede: o backend lê o conteúdo
de uma pasta do Google Drive direto pela API, usando uma **service account**.
Diferente de uma pasta mapeada no seu computador (que só existe enquanto seu
computador está ligado), isso funciona de qualquer lugar onde o backend
estiver rodando — local ou na AWS — sem depender de máquina nenhuma.

**Sobre custo**: ler arquivos com a API do Google Drive em modo somente
leitura, no volume desta pasta, não tem custo — a Google Drive API é
gratuita nesse uso. A criação do projeto no Google Cloud Console também não
exige cartão de crédito nem conta de faturamento ativa para isso. O único
"custo" real é o tempo do passo a passo abaixo (uns 10 minutos), feito uma
única vez.

## 1. Criar a service account (uma vez, no Google Cloud Console)

Isso precisa ser feito por alguém com acesso ao Google Workspace/Cloud da
Beep — eu não tenho como criar esse acesso por vocês.

1. Acesse [console.cloud.google.com](https://console.cloud.google.com/) e
   crie um projeto novo (ou use um já existente da empresa).
2. No menu, vá em **APIs e serviços → Biblioteca**, procure por **Google
   Drive API** e clique em **Ativar**.
3. Vá em **APIs e serviços → Credenciais → Criar credenciais → Conta de
   serviço**. Dê um nome (ex.: `beep-ia-drive-reader`) e conclua a criação.
4. Abra a conta de serviço criada, vá na aba **Chaves → Adicionar chave →
   Criar nova chave**, formato **JSON**, e baixe o arquivo. Guarde esse
   arquivo com cuidado — ele dá acesso de leitura à pasta compartilhada.
5. Copie o **e-mail da conta de serviço** (algo como
   `beep-ia-drive-reader@SEU-PROJETO.iam.gserviceaccount.com`).

## 2. Compartilhar a pasta com a service account

1. Abra a pasta do Drive: `https://drive.google.com/drive/folders/18EaKrwmBOTLZ1bKQ-_iC_F7_sUM6CB65`
2. Clique em **Compartilhar**, cole o e-mail da service account (passo acima)
   e dê permissão de **Leitor**.
3. Se a pasta estiver dentro de um **Drive compartilhado** (não uma pasta
   pessoal), confirme que a conta de serviço também tem acesso ao Drive
   compartilhado como um todo — não só à subpasta.

## 3. Configurar o backend

No `.env` (raiz do projeto):

```bash
GOOGLE_DRIVE_FOLDER_ID=18EaKrwmBOTLZ1bKQ-_iC_F7_sUM6CB65
GOOGLE_SERVICE_ACCOUNT_JSON='{"type": "service_account", "project_id": "...", ...}'
```

`GOOGLE_SERVICE_ACCOUNT_JSON` é o **conteúdo** do arquivo JSON baixado no
passo 1 (não o caminho do arquivo) — copie e cole o JSON inteiro em uma
única linha, entre aspas simples. **Nunca commite esse valor** — mantenha só
no seu `.env` local ou no gerenciador de segredos em produção (AWS Secrets
Manager via Terraform, ou um `Secret` do Kubernetes).

`GOOGLE_DRIVE_DEFAULT_DEPARTMENT_SLUG` é opcional — preencha só se quiser
associar todo o conteúdo da pasta a uma fila específica (ex.:
`folha-de-pagamento`). Deixe em branco para o conteúdo ficar disponível para
qualquer departamento.

## 4. Testar

1. Faça uma pergunta no chat (portal do colaborador) sobre um assunto que
   esteja em algum arquivo `.txt`/`.pdf`/Documento Google dentro da pasta — a
   sincronização roda automaticamente antes da resposta.
2. Ou dispare manualmente, com um usuário admin:
   ```bash
   curl -X POST http://localhost:8000/api/v1/knowledge/documents/sync-drive \
     -H "Authorization: Bearer <token-admin>"
   ```
   A resposta traz `{created, updated, skipped_unchanged, skipped_unsupported,
   errors}`. Se `GOOGLE_DRIVE_FOLDER_ID`/`GOOGLE_SERVICE_ACCOUNT_JSON` não
   estiverem configurados, ou a pasta não tiver sido compartilhada com a
   service account, retorna `400` explicando o problema.

## Formatos suportados

`.txt`, `.pdf` e Documentos Google nativos (exportados automaticamente como
texto simples) — inclusive dentro de subpastas, que são percorridas
recursivamente.

## Depois de configurado

Basta editar/adicionar arquivos diretamente na pasta do Drive — a próxima
resposta da IA (ou uma chamada manual ao endpoint acima) detecta a mudança
pela data de modificação do arquivo (`modifiedTime` do Drive) e reingere o
conteúdo automaticamente.

## Produção (AWS)

`infra/aws/secrets.tf` já inclui `GOOGLE_SERVICE_ACCOUNT_JSON` no AWS Secrets
Manager, e `infra/aws/variables.tf`/`terraform.tfvars.example` têm as
variáveis correspondentes (`google_drive_folder_id`,
`google_service_account_json`) — preencha o `terraform.tfvars` (nunca
commitado) com os mesmos valores do passo 3.
