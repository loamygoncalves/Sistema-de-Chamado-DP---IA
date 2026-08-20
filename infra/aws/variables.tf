variable "project_name" {
  description = "Prefixo usado no nome de todos os recursos"
  type        = string
  default     = "beep-service-desk"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

# ---------------------------------------------------------------------------
# Rede
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.20.0.0/24", "10.20.1.0/24"]
}

variable "private_subnet_cidrs" {
  type    = list(string)
  default = ["10.20.10.0/24", "10.20.11.0/24"]
}

variable "single_nat_gateway" {
  description = "true = 1 NAT Gateway só (mais barato, ponto único de falha). false = 1 por AZ."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Domínio / HTTPS (opcional — sem isso o ALB fica só em HTTP)
# ---------------------------------------------------------------------------

variable "domain_name" {
  description = "Domínio do sistema (ex.: chamados.beepsaude.com.br). Deixe em branco para HTTP-only."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Zone ID do Route53 onde o domínio acima já está hospedado (obrigatório se domain_name for preenchido)"
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Banco de dados
# ---------------------------------------------------------------------------

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_name" {
  type    = string
  default = "beep_service_desk"
}

variable "db_username" {
  type    = string
  default = "beep"
}

variable "db_multi_az" {
  description = "Alta disponibilidade do RDS (dobra o custo do banco) — recomendado ligar antes de ir para produção real."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

# ---------------------------------------------------------------------------
# IA — Amazon Bedrock (recomendado) ou Anthropic/OpenAI direto
# ---------------------------------------------------------------------------

variable "default_llm_provider" {
  description = "anthropic | openai | bedrock"
  type        = string
  default     = "bedrock"
}

variable "bedrock_model_id" {
  description = "Id exato do modelo Claude no Bedrock — confirme no console após solicitar acesso ao modelo"
  type        = string
  default     = ""
}

variable "bedrock_embedding_model_id" {
  type    = string
  default = "amazon.titan-embed-text-v2:0"
}

variable "embedding_provider" {
  description = "openai | bedrock"
  type        = string
  default     = "bedrock"
}

variable "anthropic_api_key" {
  description = "Só necessário se default_llm_provider = anthropic"
  type        = string
  default     = ""
  sensitive   = true
}

variable "openai_api_key" {
  description = "Só necessário se default_llm_provider = openai ou embedding_provider = openai"
  type        = string
  default     = ""
  sensitive   = true
}

# ---------------------------------------------------------------------------
# SSO corporativo (Keycloak/Azure AD já existentes na Beep — este Terraform
# NÃO sobe um Keycloak novo, só aponta para o IdP real)
# ---------------------------------------------------------------------------

variable "auth_provider" {
  type    = string
  default = "azure_ad"
}

variable "oidc_issuer" {
  type    = string
  default = ""
}

variable "oidc_client_id" {
  type    = string
  default = ""
}

variable "oidc_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

# ---------------------------------------------------------------------------
# Imagens de container
# ---------------------------------------------------------------------------

variable "backend_image_tag" {
  type    = string
  default = "latest"
}

variable "worker_image_tag" {
  type    = string
  default = "latest"
}

variable "frontend_image_tag" {
  type    = string
  default = "latest"
}

variable "qdrant_image" {
  type    = string
  default = "qdrant/qdrant:v1.11.3"
}

# ---------------------------------------------------------------------------
# Tamanho das tasks Fargate (cpu em vCPU-units: 256 = 0.25 vCPU; memory em MiB)
# ---------------------------------------------------------------------------

variable "backend_cpu" {
  type    = number
  default = 512
}
variable "backend_memory" {
  type    = number
  default = 1024
}
variable "backend_desired_count" {
  type    = number
  default = 2
}

variable "worker_cpu" {
  type    = number
  default = 512
}
variable "worker_memory" {
  type    = number
  default = 1024
}
variable "worker_desired_count" {
  type    = number
  default = 1
}

variable "frontend_cpu" {
  type    = number
  default = 256
}
variable "frontend_memory" {
  type    = number
  default = 512
}
variable "frontend_desired_count" {
  type    = number
  default = 2
}

variable "qdrant_cpu" {
  type    = number
  default = 512
}
variable "qdrant_memory" {
  type    = number
  default = 1024
}

variable "local_knowledge_default_department_slug" {
  type    = string
  default = ""
}
