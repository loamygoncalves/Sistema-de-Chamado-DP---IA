resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name = "${local.name}/app-secrets"
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_PASSWORD   = random_password.db_password.result
    DATABASE_URL        = "postgresql+asyncpg://${var.db_username}:${random_password.db_password.result}@${aws_db_instance.main.address}:5432/${var.db_name}"
    JWT_SECRET_KEY      = random_password.jwt_secret.result
    OIDC_CLIENT_SECRET  = var.oidc_client_secret
    ANTHROPIC_API_KEY   = var.anthropic_api_key
    OPENAI_API_KEY      = var.openai_api_key
    GOOGLE_SERVICE_ACCOUNT_JSON = var.google_service_account_json
  })
}
