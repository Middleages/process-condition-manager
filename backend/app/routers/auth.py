"""인증 라우터: 사내 SSO 자동 로그인, 로그아웃, 사용자 정보 엔드포인트."""
from urllib.parse import unquote_plus, urlencode
from uuid import uuid4

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.services.auth_service import create_access_token
from app.services.sso_service import SSOValidationError, verify_sso_id_token

router = APIRouter()

APP_COOKIE_NAME = "app_token"
NONCE_COOKIE_NAME = "sso_nonce"


class UserInfo(BaseModel):
    id: int
    userid: str
    roles: list[str]
    line_id: int | None = None
    department: str | None = None
    last_login_ip: str | None = None

    model_config = {"from_attributes": True}


class SSOUserClaims(BaseModel):
    loginid: str
    username: str
    deptname: str | None = None
    forwardedclientip: str | None = None

def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=APP_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


def _build_user_info(user: User) -> UserInfo:
    return UserInfo(
        id=user.id,
        userid=user.userid,
        roles=user.roles,
        line_id=user.line_id,
        department=user.department,
        last_login_ip=user.last_login_ip,
    )

def _build_auth_url(nonce: str) -> str:
    params = {
        "client_id": settings.IDP_CLIENT_ID,
        "redirect_uri": settings.SP_REDIRECT_URL,
        "response_mode": "form_post",
        "response_type": settings.IDP_RESPONSE_TYPE,
        "scope": settings.IDP_SCOPE,
        "nonce": nonce,
    }
    return f"{settings.IDP_ENTITY_ID}?{urlencode(params)}"


def _is_dev_login_available() -> bool:
    return settings.ENVIRONMENT == "development" or settings.DEV_LOGIN_ENABLED


def _is_allowed_dev_username(username: str) -> bool:
    allowlist = [item.strip() for item in settings.DEV_LOGIN_ALLOWLIST.split(",") if item.strip()]
    if not allowlist:
        return True
    return username in allowlist



@router.get("/login")
async def login() -> Response:
    """SSO 로그인 시작: nonce 쿠키 저장 후 IdP로 redirect."""
    nonce_val = uuid4().hex
    response = RedirectResponse(url=_build_auth_url(nonce_val), status_code=302)
    response.set_cookie(
        key=NONCE_COOKIE_NAME,
        value=nonce_val,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=300,
        path="/",
    )
    return response


@router.post("/callback")
async def callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
    sso_nonce: str | None = Cookie(default=None, alias=NONCE_COOKIE_NAME),
) -> Response:
    """IdP form_post callback 처리: id_token 검증 후 앱 쿠키 로그인."""
    form = await request.form()
    # ADFS/IdP 구현 편차로 form_post가 아닌 query 전달이 들어올 수 있어 fallback 처리
    id_token = form.get("id_token") or request.query_params.get("id_token")
    auth_code = form.get("code") or request.query_params.get("code")
    idp_error = form.get("error") or request.query_params.get("error")
    idp_error_description = form.get("error_description") or request.query_params.get("error_description")

    if idp_error:
        decoded_description = unquote_plus(str(idp_error_description or ""))
        detail = f"IdP error: {idp_error}"
        if decoded_description:
            detail = f"{detail} ({decoded_description})"
        raise HTTPException(status_code=401, detail=detail)
    if not id_token:
        detail = "Missing id_token"
        if auth_code:
            detail = "Missing id_token (received authorization code only)"
        raise HTTPException(status_code=400, detail=detail)

    if not sso_nonce:
        raise HTTPException(status_code=401, detail="Missing login nonce")

    try:
        claims = verify_sso_id_token(str(id_token))
    except SSOValidationError as exc:
        raise HTTPException(status_code=401, detail="Token verification failed") from exc

    claim_nonce = claims.get("nonce")
    if claim_nonce != sso_nonce:
        raise HTTPException(status_code=401, detail="Invalid nonce")

    sso_user = SSOUserClaims(
        loginid=claims.get("loginid", ""),
        username=claims.get("username", ""),
        deptname=claims.get("deptname"),
        forwardedclientip=claims.get("forwardedclientip"),
    )

    if not sso_user.loginid:
        raise HTTPException(status_code=401, detail="Missing loginid claim")

    result = await db.execute(select(User).where(User.userid == sso_user.loginid))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            userid=sso_user.loginid,
            roles=["editor"],
            is_active=True,
            department=sso_user.deptname,
            last_login_ip=sso_user.forwardedclientip,
        )
        db.add(user)
    else:
        user.department = sso_user.deptname
        user.last_login_ip = sso_user.forwardedclientip

    await db.commit()
    await db.refresh(user)

    payload = {"sub": str(user.id), "userid": user.userid, "roles": user.roles}
    app_token = create_access_token(payload)

    redirect_response = RedirectResponse(url=settings.FRONTEND_URL, status_code=302)
    _set_auth_cookie(redirect_response, app_token)
    redirect_response.delete_cookie(key=NONCE_COOKIE_NAME, path="/")
    return redirect_response


@router.get("/dev-login")
async def dev_login(
    userid: str | None = Query(default=None),
    username: str | None = Query(default=None, deprecated=True),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """개발 전용 로그인 우회: 지정 사용자로 app_token 쿠키를 즉시 발급."""
    if not _is_dev_login_available():
        raise HTTPException(status_code=404, detail="Not found")

    selected_userid = (userid or username or settings.DEV_LOGIN_DEFAULT_USERNAME).strip()
    if not selected_userid:
        raise HTTPException(status_code=400, detail="userid is required")
    if not _is_allowed_dev_username(selected_userid):
        raise HTTPException(status_code=403, detail="userid is not allowed")

    result = await db.execute(select(User).where(User.userid == selected_userid))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            userid=selected_userid,
            roles=["editor"],
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    payload = {"sub": str(user.id), "userid": user.userid, "roles": user.roles}
    app_token = create_access_token(payload)

    response = RedirectResponse(url=settings.FRONTEND_URL, status_code=302)
    _set_auth_cookie(response, app_token)
    return response


@router.post("/logout", status_code=200)
async def logout(response: Response) -> dict:
    """앱 쿠키 삭제로 로그아웃 처리."""
    response.delete_cookie(key=APP_COOKIE_NAME, path="/")
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserInfo)
async def get_me(current_user: User = Depends(get_current_user)) -> UserInfo:
    """현재 인증된 사용자 정보를 반환한다."""
    return _build_user_info(current_user)
