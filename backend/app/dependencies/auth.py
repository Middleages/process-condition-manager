"""인증/인가 의존성 모듈.

FastAPI Depends() 체인으로 사용되며, 모든 권한 검사는 require_active_user를 기반으로 한다.
다중 역할(roles ARRAY) 기반의 RBAC 검사를 수행한다.
"""

from fastapi import Cookie, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services.auth_service import decode_token

APP_COOKIE_NAME = "app_token"


async def get_current_user(
    app_token: str | None = Cookie(default=None, alias=APP_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> User:
    """app_token 쿠키를 디코딩·검증하고 해당 사용자를 로드한다."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
    )
    if app_token is None:
        raise credentials_exception

    try:
        payload = decode_token(app_token)
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = await db.get(User, int(user_id))
    if user is None:
        raise credentials_exception
    return user


async def require_active_user(
    user: User = Depends(get_current_user),
) -> User:
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    return user


async def require_reviewer(
    user: User = Depends(require_active_user),
) -> User:
    if "reviewer" not in user.roles and "admin" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reviewer or admin access required",
        )
    return user


async def require_admin(
    user: User = Depends(require_active_user),
) -> User:
    if "admin" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


async def require_project_owner(
    project_id: int,
    user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    from app.models.project import Project

    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    if "admin" in user.roles or project.created_by == user.id:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have access to this project",
    )


async def require_admin_or_developer(
    user: User = Depends(require_active_user),
) -> User:
    if "admin" not in user.roles and "developer" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or developer access required",
        )
    return user


async def require_ops_write(
    user: User = Depends(require_active_user),
) -> User:
    if "admin" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required for operations write",
        )
    return user


async def require_system_write(
    user: User = Depends(require_active_user),
) -> User:
    if "developer" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Developer access required for system config write",
        )
    return user
