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
    DEFAULT_LLM_PROVIDER: str = "anthropic"  # anthropic | openai
    ANTHROPIC_API_KEY: str | None = None
    ANTHROPIC_MODEL: str = "claude-sonnet-5"
    OPENAI_API_KEY: str | None = None
    OPENAI_MODEL: str = "gpt-4o"
    EMBEDDING_PROVIDER: str = "openai"  # openai | anthropic-compatible
    EMBEDDING_MODEL: str = "text-embedding-3-small"

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

    # Sincronização automática da base de conhecimento com uma pasta do Google
    # Drive — um worker periódico reingesta documentos novos/alterados sem
    # intervenção manual (ver app/services/drive_sync_service.py).
    GOOGLE_DRIVE_SYNC_ENABLED: bool = False
    GOOGLE_DRIVE_FOLDER_ID: str | None = None
    GOOGLE_SERVICE_ACCOUNT_FILE: str | None = None
    GOOGLE_DRIVE_DEFAULT_DEPARTMENT_SLUG: str | None = None
    DRIVE_SYNC_INTERVAL_MINUTES: int = 15

    CORS_ORIGINS: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
