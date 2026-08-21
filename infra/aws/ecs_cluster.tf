resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${local.name}/backend"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${local.name}/worker"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/ecs/${local.name}/frontend"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "qdrant" {
  name              = "/ecs/${local.name}/qdrant"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${local.name}/migrate"
  retention_in_days = 30
}

locals {
  # Env comum a backend e worker — mantido num único lugar para as duas task
  # definitions não divergirem sem querer.
  app_environment = [
    { name = "ENVIRONMENT", value = var.environment },
    { name = "API_V1_PREFIX", value = "/api/v1" },
    { name = "PUBLIC_BASE_URL", value = local.use_https ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}" },
    { name = "REDIS_URL", value = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:6379/0" },
    { name = "CELERY_BROKER_URL", value = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:6379/1" },
    { name = "CELERY_RESULT_BACKEND", value = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:6379/2" },
    { name = "QDRANT_URL", value = "http://qdrant.${local.name}.internal:6333" },
    { name = "QDRANT_COLLECTION", value = "beep_knowledge_base" },
    { name = "EMBEDDING_DIM", value = "1536" },
    { name = "AUTH_PROVIDER", value = var.auth_provider },
    { name = "OIDC_ISSUER", value = var.oidc_issuer },
    { name = "OIDC_CLIENT_ID", value = var.oidc_client_id },
    { name = "OIDC_REDIRECT_URI", value = "${local.use_https ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"}/api/v1/auth/callback" },
    { name = "ACCESS_TOKEN_EXPIRE_MINUTES", value = "15" },
    { name = "REFRESH_TOKEN_EXPIRE_DAYS", value = "7" },
    { name = "DEFAULT_LLM_PROVIDER", value = var.default_llm_provider },
    { name = "ANTHROPIC_MODEL", value = "claude-sonnet-5" },
    { name = "OPENAI_MODEL", value = "gpt-4o" },
    { name = "EMBEDDING_PROVIDER", value = var.embedding_provider },
    { name = "EMBEDDING_MODEL", value = "text-embedding-3-small" },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "BEDROCK_MODEL_ID", value = var.bedrock_model_id },
    { name = "BEDROCK_EMBEDDING_MODEL_ID", value = var.bedrock_embedding_model_id },
    { name = "CONFIDENCE_THRESHOLD_AUTO", value = "0.85" },
    { name = "CONFIDENCE_THRESHOLD_SUGGEST", value = "0.60" },
    { name = "RAG_TOP_K", value = "6" },
    { name = "CHAT_HISTORY_MAX_MESSAGES", value = "12" },
    { name = "S3_BUCKET", value = aws_s3_bucket.storage.bucket },
    { name = "LOCAL_KNOWLEDGE_FOLDER", value = "/data/knowledge-base" },
    { name = "LOCAL_KNOWLEDGE_DEFAULT_DEPARTMENT_SLUG", value = var.local_knowledge_default_department_slug },
    { name = "GOOGLE_DRIVE_FOLDER_ID", value = var.google_drive_folder_id },
    { name = "GOOGLE_DRIVE_DEFAULT_DEPARTMENT_SLUG", value = var.google_drive_default_department_slug },
    { name = "CORS_ORIGINS", value = jsonencode([local.use_https ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"]) },
  ]

  app_secrets = [
    { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::" },
    { name = "JWT_SECRET_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:JWT_SECRET_KEY::" },
    { name = "OIDC_CLIENT_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:OIDC_CLIENT_SECRET::" },
    { name = "ANTHROPIC_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:ANTHROPIC_API_KEY::" },
    { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:OPENAI_API_KEY::" },
    { name = "GOOGLE_SERVICE_ACCOUNT_JSON", valueFrom = "${aws_secretsmanager_secret.app.arn}:GOOGLE_SERVICE_ACCOUNT_JSON::" },
  ]

  knowledge_base_mount_point = {
    sourceVolume  = "knowledge-base"
    containerPath = "/data/knowledge-base"
    readOnly      = true
  }
}
