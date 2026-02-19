"""Authentication router providing login, logout, token refresh, and user info endpoints."""

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
# Response / Request schemas
# ---------------------------------------------------------------------------

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_PATH = "/api/auth"


class UserInfo(BaseModel):
    id: int
    username: str
    display_name: str
    role: str

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserInfo


class TokenResponse(BaseModel):
    access_token: str
    token_type: str


# ---------------------------------------------------------------------------
# Helper: build token payload
# ---------------------------------------------------------------------------

def _build_token_payload(user: User) -> dict:
    return {"sub": str(user.id), "username": user.username, "role": user.role}


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        samesite="lax",
        path=REFRESH_COOKIE_PATH,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/login", response_model=LoginResponse)
async def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    """Authenticate a user and return an access token + set refresh cookie.

    Accepts OAuth2 form fields (username, password).
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
        user=UserInfo.model_validate(user),
    )


@router.post("/logout", status_code=200)
async def logout(response: Response) -> dict:
    """Clear the refresh token cookie and log the user out."""
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
    return {"message": "Logged out successfully"}


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    db: AsyncSession = Depends(get_db),
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
) -> TokenResponse:
    """Issue a new access token using a valid refresh token from the HTTP-only cookie."""
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
    """Return the currently authenticated user's information."""
    return UserInfo.model_validate(current_user)
