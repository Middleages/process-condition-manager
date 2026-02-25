"""인증/인가 의존성 모듈.

FastAPI Depends() 체인으로 사용되며, 모든 권한 검사는 require_active_user를 기반으로 한다.
다중 역할(roles ARRAY) 기반의 RBAC 검사를 수행한다.
"""

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
    """Bearer 토큰을 디코딩·검증하고 해당 사용자를 로드한다.

    Raises:
        HTTPException 401: 토큰이 없거나, 유효하지 않거나, 사용자가 존재하지 않을 때.
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
    """인증된 사용자의 계정이 활성 상태인지 확인한다.

    Raises:
        HTTPException 403: 사용자 계정이 비활성 상태일 때.
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
    """reviewer 또는 admin 역할을 가진 사용자만 허용한다.

    Raises:
        HTTPException 403: reviewer/admin 역할이 없을 때.
    """
    if "reviewer" not in user.roles and "admin" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reviewer or admin access required",
        )
    return user


async def require_admin(
    user: User = Depends(require_active_user),
) -> User:
    """admin 역할을 가진 사용자만 허용한다.

    Raises:
        HTTPException 403: admin 역할이 없을 때.
    """
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
    """프로젝트 소유자이거나 admin 역할을 가진 사용자만 허용한다.

    Args:
        project_id: 소유권을 확인할 프로젝트 ID.

    Raises:
        HTTPException 404: 프로젝트가 존재하지 않을 때.
        HTTPException 403: 프로젝트 소유자가 아니고 admin도 아닐 때.
    """
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


# ---------------------------------------------------------------------------
# 신규 의존성: admin/developer 분리된 역할 검사
# ---------------------------------------------------------------------------

async def require_admin_or_developer(
    user: User = Depends(require_active_user),
) -> User:
    """admin 또는 developer 역할을 가진 사용자만 허용한다 (읽기 전용 관리 접근).

    Raises:
        HTTPException 403: admin/developer 역할이 없을 때.
    """
    if "admin" not in user.roles and "developer" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or developer access required",
        )
    return user


async def require_ops_write(
    user: User = Depends(require_active_user),
) -> User:
    """운영 데이터(라인/제품/레이어/설비) 쓰기 시 admin 역할 필수.

    Raises:
        HTTPException 403: admin 역할이 없을 때.
    """
    if "admin" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required for operations write",
        )
    return user


async def require_system_write(
    user: User = Depends(require_active_user),
) -> User:
    """시스템 설정(컬럼/카테고리/매핑/출력) 쓰기 시 developer 역할 필수.

    Raises:
        HTTPException 403: developer 역할이 없을 때.
    """
    if "developer" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Developer access required for system config write",
        )
    return user
