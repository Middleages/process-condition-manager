"""Authentication dependencies for FastAPI dependency injection."""

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services.auth_service import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Decode and validate Bearer token, then load the corresponding user.

    Raises:
        HTTPException 401: If the token is missing, invalid, or the user does not exist.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if token is None:
        raise credentials_exception
    try:
        payload = decode_token(token)
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
    """Ensure the authenticated user's account is active.

    Raises:
        HTTPException 403: If the user's account is inactive.
    """
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    return user


async def require_reviewer(
    user: User = Depends(require_active_user),
) -> User:
    """Ensure the authenticated user has reviewer or admin role.

    Raises:
        HTTPException 403: If the user does not have reviewer or admin role.
    """
    if user.role not in ("reviewer", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reviewer or admin access required",
        )
    return user


async def require_admin(
    user: User = Depends(require_active_user),
) -> User:
    """Ensure the authenticated user has admin role.

    Raises:
        HTTPException 403: If the user does not have admin role.
    """
    if user.role != "admin":
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
    """Ensure the authenticated user owns the project or has admin role.

    Args:
        project_id: The ID of the project to check ownership for.

    Raises:
        HTTPException 404: If the project does not exist.
        HTTPException 403: If the user does not own the project and is not admin.
    """
    from app.models.project import Project

    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    if user.role == "admin" or project.created_by == user.id:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have access to this project",
    )
