# Deploy na AWS — BEEP AI Service Desk

Guia passo a passo para colocar o sistema no ar na AWS usando o Terraform em
`infra/aws/`. Arquitetura: ECS Fargate (containers, sem gerenciar servidor),
RDS Postgres, ElastiCache Redis, Qdrant self-hosted num Fargate à parte,
Amazon Bedrock para o Claude (sem chave de API separada), EFS para a pasta de
conhecimento e para o storage do Qdrant, S3 para anexos, tudo atrás de um
Application Load Balancer.

Nenhum destes recursos existe ainda — este documento parte do zero.

## 0. Pré-requisitos

1. **Conta AWS** — se ainda não tem, crie em https://aws.amazon.com/. Recomendo
   não usar a conta "root" no dia a dia: crie um usuário/role de administração
   via IAM Identity Center assim que a conta existir.
2. **AWS CLI** instalado e autenticado (`aws configure` ou `aws sso login`).
   Confirme com `aws sts get-caller-identity`.
3. **Terraform** ≥ 1.5 instalado (`terraform version`).
4. **Docker** instalado (para buildar e enviar as imagens pro ECR).
5. Acesso ao [console do Amazon Bedrock](https://console.aws.amazon.com/bedrock/)
   na região escolhida (padrão `us-east-1`).

## 1. Solicitar acesso ao modelo Claude no Bedrock

1. Console do Bedrock → **Model access** (menu lateral) → **Manage model access**.
2. Marque os modelos Claude (ex.: **Claude Sonnet**) e envie o pedido — na
   maioria das contas isso é aprovado automaticamente, na hora.
3. Depois de aprovado, vá em **Model catalog**, clique no modelo desejado e
   copie o **Model ID** exato (algo como `anthropic.claude-sonnet-...-v1:0`
   ou, em alguns modelos mais novos, com o prefixo `us.anthropic....`). Esse
   valor vai em `bedrock_model_id` no `terraform.tfvars` — **não adivinhe**,
   confirme o id certo ali no catálogo, porque a nomenclatura varia por
   modelo/região.

## 2. Configurar o Terraform

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars
```

Edite `terraform.tfvars`:
- `aws_region`: região onde o Bedrock foi liberado (passo 1).
- `bedrock_model_id`: o id copiado no passo 1.
- `domain_name` / `route53_zone_id`: preencha se já tiver um domínio com a
  zona hospedada no Route53 (recomendado antes de ir para uso real — sem
  isso o sistema fica em HTTP simples, sem certificado). Pode deixar em
  branco para validar o piloto primeiro e adicionar depois.
- `auth_provider` / `oidc_issuer` / `oidc_client_id` / `oidc_client_secret`:
  aponte para o SSO corporativo real da Beep (Azure AD ou Keycloak já
  existente) — **este Terraform não cria um Keycloak novo**, só conecta o
  sistema a um IdP que já existe.

`terraform.tfvars` nunca deve ser commitado (já está no `.gitignore`) — ele
carrega segredos em texto puro.

```bash
terraform init
terraform plan   # revise o que vai ser criado antes de aplicar
terraform apply
```

Isso leva uns 10–15 minutos (RDS e EFS demoram um pouco). Ao final, anote os
outputs — principalmente `app_url`, `ecr_backend_repository_url`,
`ecr_worker_repository_url`, `ecr_frontend_repository_url`.

**Nesse ponto os serviços do ECS vão ficar tentando subir e falhando** — é
esperado, porque ainda não existe nenhuma imagem nos repositórios ECR. Isso
se resolve no próximo passo.

## 3. Buildar e enviar as imagens

```bash
aws ecr get-login-password --region <aws_region> | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.<aws_region>.amazonaws.com

# Backend
docker build -t <ecr_backend_repository_url>:latest -f backend/Dockerfile backend
docker push <ecr_backend_repository_url>:latest

# Worker
docker build -t <ecr_worker_repository_url>:latest -f backend/Dockerfile.worker backend
docker push <ecr_worker_repository_url>:latest

# Frontend — NEXT_PUBLIC_API_BASE_URL PRECISA ser o app_url real (build-arg,
# não env de runtime — o Next.js embute isso no bundle durante o build)
docker build \
  --build-arg NEXT_PUBLIC_API_BASE_URL="<app_url>/api/v1" \
  --build-arg NEXT_PUBLIC_APP_NAME="BEEP AI Service Desk" \
  -t <ecr_frontend_repository_url>:latest -f frontend/Dockerfile frontend
docker push <ecr_frontend_repository_url>:latest
```

Em alguns minutos o ECS detecta as imagens novas e os serviços sobem
sozinhos (ele fica tentando relançar as tasks que falharam). Se quiser
acelerar, force um novo deployment:

```bash
aws ecs update-service --cluster <ecs_cluster_name> --service <project_name>-backend  --force-new-deployment
aws ecs update-service --cluster <ecs_cluster_name> --service <project_name>-worker   --force-new-deployment
aws ecs update-service --cluster <ecs_cluster_name> --service <project_name>-frontend --force-new-deployment
aws ecs update-service --cluster <ecs_cluster_name> --service <project_name>-qdrant   --force-new-deployment
```

## 4. Rodar as migrações do banco

```bash
terraform output -json migrate_network_configuration > /tmp/netcfg.json
aws ecs run-task \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --task-definition $(terraform output -raw migrate_task_definition_arn) \
  --launch-type FARGATE \
  --network-configuration file:///tmp/netcfg.json
```

Acompanhe pelos logs no CloudWatch (`/ecs/<project_name>/migrate`) até ver
"Running upgrade ... -> head".

## 5. Popular dados de exemplo (opcional)

Mesma lógica do passo 4, mas sobrescrevendo o `command` da task de backend
para `python -m scripts.seed_demo_data` — ou simplesmente rode localmente
apontando `DATABASE_URL` para o RDS (via um túnel SSM, já que o RDS não é
público):

```bash
aws ssm start-session --target <alguma-instância-na-vpc> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<rds_endpoint>"],"portNumber":["5432"],"localPortNumber":["5432"]}'
```

(Precisa de uma instância EC2/Fargate qualquer já rodando na VPC com o
plugin SSM — ou pule este passo e cadastre os dados reais direto pela
aplicação.)

## 6. Colocar os arquivos da base de conhecimento no EFS

O `local_folder_sync_service` lê `.txt`/`.pdf` de `/data/knowledge-base`
dentro dos containers — que é o Access Point do EFS criado pelo Terraform
(`efs_file_system_id` no output). Duas formas de colocar arquivos lá:

**Opção rápida (poucos arquivos, uma vez):** suba uma instância EC2 pequena
na mesma VPC/subnet privada, monte o EFS (`sudo mount -t efs
<efs_file_system_id>:/ /mnt/efs`), copie os arquivos para
`/mnt/efs/knowledge-base/` via `scp`/`rsync`, depois termine a instância.

**Opção recomendada para manter sincronizado com a pasta de rede real da
Beep:** [AWS DataSync](https://aws.amazon.com/datasync/) — cria uma tarefa
agendada que replica automaticamente de uma pasta de rede (SMB/NFS, via um
agente DataSync instalado na rede local da Beep) para este EFS. Isso mantém
exatamente o mesmo conceito de "pasta compartilhada" que já existe hoje, só
que replicada também para a AWS.

## 7. Acessar o sistema

Abra o `app_url` (output do Terraform) — se `domain_name` não foi
configurado, é o endereço do próprio Load Balancer
(`http://<alb_dns_name>`).

## 8. Automatizar deploys futuros (opcional)

`.github/workflows/deploy-aws.yml` já existe, mas fica **desativado por
padrão** (só roda com disparo manual) até você configurar:

1. Um IAM Role assumível via OIDC do GitHub Actions (veja a
   [documentação da AWS](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html))
   com permissão para ECR, ECS, Secrets Manager, e Terraform apply na infra —
   salve o ARN em **Settings → Secrets and variables → Actions →**
   `AWS_DEPLOY_ROLE_ARN`.
2. `AWS_REGION` como **repository variable**.
3. `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`OIDC_CLIENT_SECRET` como secrets,
   se aplicável.

Depois disso, rodar o workflow manualmente builda, envia pro ECR, atualiza a
infraestrutura via Terraform e roda as migrações — tudo num só clique.

## Custo aproximado (piloto, `us-east-1`, valores de referência)

| Recurso | Estimativa mensal |
|---|---|
| RDS `db.t4g.micro` (single-AZ) | ~US$ 13 |
| ElastiCache `cache.t4g.micro` | ~US$ 12 |
| ECS Fargate (backend×2 + worker×1 + frontend×2 + qdrant×1, tamanhos padrão) | ~US$ 45–60 |
| Application Load Balancer | ~US$ 16 + tráfego |
| NAT Gateway (1, padrão) | ~US$ 32 + tráfego |
| EFS | poucos centavos por GB |
| Bedrock (Claude) | por token, sem custo fixo — mesmo modelo de custo já explicado antes |
| **Total aproximado** | **~US$ 120–150/mês** antes do uso de IA |

Isso é uma estimativa de referência, não uma cotação — o custo real varia
com volume de tráfego e uso da IA. Dá para reduzir bastante desativando
`db_multi_az` (já é o padrão) e usando 1 réplica em vez de 2 no backend/
frontend para um piloto bem pequeno (`backend_desired_count = 1`,
`frontend_desired_count = 1` no `terraform.tfvars`).

## Antes de ir para produção real (não piloto)

- Configure `domain_name` + `route53_zone_id` para ligar HTTPS — hoje sem
  isso o tráfego (login, token) passa em HTTP puro.
- Ligue `db_multi_az = true` no RDS.
- Revise o IAM Role usado pelo GitHub Actions (permissões mínimas necessárias).
- Configure alarmes no CloudWatch (erro 5xx no ALB, CPU/memória das tasks,
  espaço livre no RDS).
- Considere AWS WAF na frente do ALB.

## Desmontar tudo

```bash
cd infra/aws
terraform destroy
```

**Isso apaga o RDS, o EFS (perde os arquivos da base de conhecimento e o
índice do Qdrant) e todo o resto.** `deletion_protection` está ligado no RDS
de propósito — será preciso desligar essa flag (`terraform apply` com
`db_multi_az`/proteção ajustada, ou `aws rds modify-db-instance
--no-deletion-protection`) antes do destroy conseguir remover o banco.
