from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_department_lead
from app.db.session import get_db
from app.models.user import User
from app.schemas.dashboard import DashboardSummary, DepartmentBreakdown
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
async def summary(
    date_from: datetime | None = Query(None, alias="from"),
    date_to: datetime | None = Query(None, alias="to"),
    user: User = Depends(require_department_lead),
    db: AsyncSession = Depends(get_db),
):
    data = await dashboard_service.get_summary(db, date_from, date_to)
    return DashboardSummary(**data)


@router.get("/by-department", response_model=list[DepartmentBreakdown])
async def by_department(user: User = Depends(require_department_lead), db: AsyncSession = Depends(get_db)):
    return await dashboard_service.get_by_department(db)


@router.get("/sla")
async def sla(user: User = Depends(require_department_lead), db: AsyncSession = Depends(get_db)):
    data = await dashboard_service.get_summary(db, None, None)
    return {"sla_medio_horas": data["sla_medio_horas"], "tempo_medio_resolucao_horas": data["tempo_medio_resolucao_horas"]}
