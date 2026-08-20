from fastapi import APIRouter

from app.api.v1 import audit, auth, chat, dashboard, departments, knowledge, settings, tickets

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(chat.router)
api_router.include_router(tickets.router)
api_router.include_router(departments.router)
api_router.include_router(knowledge.router)
api_router.include_router(settings.router)
api_router.include_router(dashboard.router)
api_router.include_router(audit.router)
