import base64
import hashlib
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user
from app.core.oidc import oidc_client
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.user import UserRead
from app.services.audit_service import record_audit_log

router = APIRouter(prefix="/auth", tags=["auth"])


def _code_verifier_and_challenge() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(40)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


@router.get("/login")
async def login():
    verifier, challenge = _code_verifier_and_challenge()
    # O verifier viaja embutido no `state` (assinado, curta duração) para não exigir
    # sessão de servidor — o IdP devolve o mesmo `state` no callback.
    state = jwt.encode({"cv": verifier}, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    url = oidc_client.build_authorize_url(state=state, code_challenge=challenge)
    return {"authorize_url": url}


@router.get("/callback")
async def callback(code: str, state: str, db: AsyncSession = Depends(get_db)):
    try:
        state_payload = jwt.decode(state, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "State inválido") from exc

    token_response = await oidc_client.exchange_code(code, state_payload["cv"])
    userinfo = await oidc_client.userinfo(token_response["access_token"])

    sub = userinfo["sub"]
    email = userinfo.get("email")
    name = userinfo.get("name", email)
    matricula = userinfo.get("employee_number") or userinfo.get("matricula")

    result = await db.execute(select(User).where(User.identity_provider_sub == sub))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(
            name=name, email=email, matricula=matricula, identity_provider_sub=sub, role=UserRole.EMPLOYEE
        )
        db.add(user)
        await db.flush()

    access_token = create_access_token(subject=user.id, role=user.role.value)
    refresh_token = create_refresh_token(subject=user.id)
    await record_audit_log(db, user_id=user.id, action="login", entity="user", entity_id=str(user.id))
    await db.commit()

    return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}


@router.post("/refresh")
async def refresh(refresh_token: str, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_token(refresh_token)
    except Exception as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token inválido") from exc
    if payload.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tipo de token inválido")

    user = await db.get(User, uuid.UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário inválido")

    return {"access_token": create_access_token(subject=user.id, role=user.role.value), "token_type": "bearer"}


@router.post("/logout")
async def logout(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await record_audit_log(db, user_id=user.id, action="logout", entity="user", entity_id=str(user.id))
    await db.commit()
    return {"detail": "Sessão encerrada"}


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(get_current_user)):
    return user
