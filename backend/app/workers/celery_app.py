from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "beep_service_desk",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="America/Sao_Paulo",
    enable_utc=True,
)

if settings.GOOGLE_DRIVE_SYNC_ENABLED:
    celery_app.conf.beat_schedule = {
        "sync-google-drive-folder": {
            "task": "knowledge.sync_google_drive_folder",
            "schedule": settings.DRIVE_SYNC_INTERVAL_MINUTES * 60,
        },
    }
