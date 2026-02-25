"""인증 라우터: 로그인, 로그아웃, 토큰 갱신, 사용자 정보 엔드포인트."""

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.services.auth_service import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from jose import JWTError

router = APIRouter()

# ---------------------------------------------------------------------------
# Response / Request 스키마
# ---------------------------------------------------------------------------

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_PATH = "/api/auth"


class UserInfo(BaseModel):
    id: int
    username: str
    display_name: str
    roles: list[str]

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserInfo


class TokenResponse(BaseModel):
    access_token: str
    token_type: str


# ---------------------------------------------------------------------------
# 헬퍼: 토큰 페이로드 구성
# ---------------------------------------------------------------------------

def _build_token_payload(user: User) -> dict:
    """JWT 페이로드에 사용자 정보를 포함한다. roles 배열로 다중 역할 전달."""
    return {"sub": str(user.id), "username": user.username, "roles": user.roles}


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        samesite="lax",
        path=REFRESH_COOKIE_PATH,
    )


# ---------------------------------------------------------------------------
# 엔드포인트
# ---------------------------------------------------------------------------

@router.post("/login", response_model=LoginResponse)
async def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    """사용자 인증 후 access token 발급 + refresh cookie 설정.

    OAuth2 form fields (username, password)를 받는다.
    """
    result = await db.execute(select(User).where(User.username == form_data.username))
    user: User | None = result.scalar_one_or_none()

    if user is None or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive",
        )

    payload = _build_token_payload(user)
    access_token = create_access_token(payload)
    refresh_token = create_refresh_token(payload)
    _set_refresh_cookie(response, refresh_token)

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserInfo(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            roles=user.roles,
        ),
    )


@router.post("/logout", status_code=200)
async def logout(response: Response) -> dict:
    """Refresh token 쿠키를 삭제하여 로그아웃 처리."""
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
    return {"message": "Logged out successfully"}


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    db: AsyncSession = Depends(get_db),
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
) -> TokenResponse:
    """HTTP-only 쿠키의 refresh token으로 새 access token 발급."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
    )
    if refresh_token is None:
        raise credentials_exception

    try:
        payload = decode_token(refresh_token)
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = await db.get(User, int(user_id))
    if user is None or not user.is_active:
        raise credentials_exception

    new_payload = _build_token_payload(user)
    access_token = create_access_token(new_payload)
    return TokenResponse(access_token=access_token, token_type="bearer")


@router.get("/me", response_model=UserInfo)
async def get_me(
    current_user: User = Depends(get_current_user),
) -> UserInfo:
    """현재 인증된 사용자의 정보를 반환."""
    return UserInfo(
        id=current_user.id,
        username=current_user.username,
        display_name=current_user.display_name,
        roles=current_user.roles,
    )
