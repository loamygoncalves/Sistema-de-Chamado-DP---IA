from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    APP_NAME: str = "BEEP AI Service Desk"
    ENVIRONMENT: str = "development"
    API_V1_PREFIX: str = "/api/v1"
    PUBLIC_BASE_URL: str = "https://operacoes-playground.internal.beepsaude.com.br"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://beep:beep@localhost:5432/beep_service_desk"

    # Redis / Celery
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # Qdrant
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str | None = None
    QDRANT_COLLECTION: str = "beep_knowledge_base"
    EMBEDDING_DIM: int = 1536

    # Auth
    AUTH_PROVIDER: str = "keycloak"  # keycloak | azure_ad
    OIDC_ISSUER: str = "https://sso.beepsaude.com.br/realms/beep"
    OIDC_CLIENT_ID: str = "beep-ai-service-desk"
    OIDC_CLIENT_SECRET: str = "change-me"
    OIDC_REDIRECT_URI: str = "https://operacoes-playground.internal.beepsaude.com.br/api/v1/auth/callback"
    JWT_SECRET_KEY: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # AI providers
    DEFAULT_LLM_PROVIDER: str = "anthropic"  # anthropic | openai | bedrock
    ANTHROPIC_API_KEY: str | None = None
    ANTHROPIC_MODEL: str = "claude-sonnet-5"
    OPENAI_API_KEY: str | None = None
    OPENAI_MODEL: str = "gpt-4o"
    EMBEDDING_PROVIDER: str = "openai"  # openai | bedrock
    EMBEDDING_MODEL: str = "text-embedding-3-small"

    # Amazon Bedrock (Claude e Titan Embeddings dentro da própria conta AWS,
    # sem chave de API separada — usa a role IAM da task do ECS/instância).
    # Requer solicitar acesso ao modelo no console do Bedrock antes de usar.
    AWS_REGION: str = "us-east-1"
    BEDROCK_MODEL_ID: str | None = None  # ex.: "anthropic.claude-sonnet-4-5-20250929-v1:0" — confirme o id exato no console do Bedrock
    BEDROCK_EMBEDDING_MODEL_ID: str = "amazon.titan-embed-text-v2:0"

    # Confidence routing thresholds (parametrizable, overridable via ai_settings table)
    CONFIDENCE_THRESHOLD_AUTO: float = 0.85
    CONFIDENCE_THRESHOLD_SUGGEST: float = 0.60
    RAG_TOP_K: int = 6
    # Nº de mensagens anteriores (usuário+IA) enviadas como memória de conversa
    # a cada nova pergunta. Maior = perguntas de acompanhamento fazem mais
    # sentido, mas cada mensagem custa mais tokens de entrada no LLM.
    CHAT_HISTORY_MAX_MESSAGES: int = 12

    # Object storage
    S3_ENDPOINT_URL: str = "http://localhost:9000"
    S3_BUCKET: str = "beep-service-desk"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"

    # Sincronização automática da base de conhecimento com uma pasta local ou
    # de rede (montada no container) — 100% local, sem custo e sem depender de
    # nenhuma API externa. Arquivos .txt e .pdf são lidos diretamente (ver
    # app/services/local_folder_sync_service.py). Deixe em branco para
    # desativar a sincronização.
    LOCAL_KNOWLEDGE_FOLDER: str | None = None
    LOCAL_KNOWLEDGE_DEFAULT_DEPARTMENT_SLUG: str | None = None

    # Alternativa à pasta local: sincronização com uma pasta do Google Drive
    # (útil quando não existe um servidor de arquivos de rede real, mas o
    # conteúdo já mora numa pasta/Drive compartilhado do Google Workspace).
    # Não depende do computador de ninguém estar ligado — o backend acessa o
    # Drive direto pela API, com uma service account (ver
    # docs/GOOGLE_DRIVE_SETUP.md). Deixe em branco para desativar.
    GOOGLE_DRIVE_FOLDER_ID: str | None = None
    GOOGLE_SERVICE_ACCOUNT_JSON: str | None = None  # conteúdo JSON da chave da service account (não o caminho)
    GOOGLE_DRIVE_DEFAULT_DEPARTMENT_SLUG: str | None = None

    # Notificação por e-mail quando um chamado é aberto, respondido
    # publicamente por um analista, ou finalizado. Deixe
    # EMAIL_NOTIFICATIONS_ENABLED em false (padrão) para desativar — nesse
    # caso o envio é pulado silenciosamente, sem erro.
    EMAIL_NOTIFICATIONS_ENABLED: bool = False
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_USE_TLS: bool = True
    SMTP_FROM_EMAIL: str = "dp@beepsaude.com.br"

    CORS_ORIGINS: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
