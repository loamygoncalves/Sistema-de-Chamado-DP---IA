import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_admin, require_employee
from app.db.session import get_db
from app.models.department import Department
from app.models.user import User
from app.schemas.department import DepartmentCreate, DepartmentRead

router = APIRouter(prefix="/departments", tags=["departments"])


@router.get("", response_model=list[DepartmentRead])
async def list_departments(user: User = Depends(require_employee), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Department).where(Department.is_active.is_(True)).order_by(Department.name))
    return result.scalars().all()


@router.post("", response_model=DepartmentRead)
async def create_department(payload: DepartmentCreate, user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    department = Department(**payload.model_dump())
    db.add(department)
    await db.commit()
    await db.refresh(department)
    return department


@router.patch("/{department_id}", response_model=DepartmentRead)
async def update_department(
    department_id: uuid.UUID, payload: DepartmentCreate, user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)
):
    department = await db.get(Department, department_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(department, key, value)
    await db.commit()
    await db.refresh(department)
    return department
