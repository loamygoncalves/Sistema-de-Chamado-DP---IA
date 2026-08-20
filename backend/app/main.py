import logging
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from app.api.v1 import api_router
from app.core.config import settings
from app.services.vector_store import vector_store

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    logger_factory=structlog.stdlib.LoggerFactory(),
)
logging.basicConfig(level=logging.INFO)
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await vector_store.ensure_collection()
    logger.info("startup_complete", app=settings.APP_NAME, environment=settings.ENVIRONMENT)
    yield
    logger.info("shutdown_complete")


app = FastAPI(
    title=settings.APP_NAME,
    description="Central de Atendimento Inteligente para colaboradores da BEEP Saúde.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app, endpoint="/metrics")

app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME}
