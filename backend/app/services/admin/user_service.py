"""Admin 사용자 관리 서비스 (CRUD, 비밀번호 초기화, 비활성화)."""

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models import User
from app.schemas.admin_user import AdminUserCreate, AdminUserUpdate, AdminPasswordReset, AdminUserResponse
from app.services.auth_service import get_password_hash


async def _count_active_admins(db: AsyncSession) -> int:
    """활성 상태의 admin 역할 사용자 수를 반환한다."""
    result = await db.execute(
        select(func.count()).select_from(User).where(
            User.roles.contains(["admin"]), User.is_active.is_(True)
        )
    )
    return result.scalar_one()


async def list_users(db: AsyncSession, include_inactive: bool = False) -> list[AdminUserResponse]:
    """모든 사용자 목록을 display_name 기준으로 정렬하여 반환한다. 기본적으로 비활성 사용자는 제외."""
    query = select(User).order_by(User.display_name)
    if not include_inactive:
        query = query.where(User.is_active.is_(True))
    result = await db.execute(query)
    users = result.scalars().all()
    return [AdminUserResponse.model_validate(u) for u in users]


async def create_user(db: AsyncSession, data: AdminUserCreate) -> AdminUserResponse:
    """신규 사용자를 생성한다. username/email 중복 시 409 에러."""
    # username 중복 검사
    existing = await db.execute(select(User).where(User.username == data.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Username '{data.username}' already exists")

    # email 중복 검사 (제공된 경우)
    if data.email:
        existing_email = await db.execute(select(User).where(User.email == data.email))
        if existing_email.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Email '{data.email}' already exists")

    user = User(
        username=data.username,
        display_name=data.display_name,
        email=data.email,
        roles=data.roles,
        password_hash=get_password_hash(data.password),
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return AdminUserResponse.model_validate(user)


async def update_user(db: AsyncSession, user_id: int, data: AdminUserUpdate) -> AdminUserResponse:
    """사용자 정보를 수정한다. 404: 사용자 없음, 400: 마지막 admin 역할 제거 시도."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if data.display_name is not None:
        user.display_name = data.display_name
    if data.email is not None:
        user.email = data.email
    if data.roles is not None:
        # 마지막 admin 보호: 기존에 admin 역할이 있었는데 새 역할에 admin이 없으면 확인
        if "admin" in (user.roles or []) and "admin" not in data.roles:
            admin_count = await _count_active_admins(db)
            if admin_count <= 1:
                raise HTTPException(
                    status_code=400,
                    detail="마지막 관리자의 역할을 변경할 수 없습니다",
                )
        user.roles = data.roles
    if data.is_active is not None:
        user.is_active = data.is_active
    if "line_id" in data.model_fields_set:
        user.line_id = data.line_id

    await db.commit()
    await db.refresh(user)
    return AdminUserResponse.model_validate(user)


async def deactivate_user(db: AsyncSession, user_id: int, current_user_id: int) -> None:
    """사용자를 비활성화한다. 자기 자신 비활성화 불가, 마지막 admin 비활성화 불가."""
    if user_id == current_user_id:
        raise HTTPException(status_code=400, detail="자기 자신을 비활성화할 수 없습니다")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if "admin" in (user.roles or []):
        admin_count = await _count_active_admins(db)
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="마지막 관리자를 비활성화할 수 없습니다",
            )

    user.is_active = False
    await db.commit()


async def reset_password(db: AsyncSession, user_id: int, data: AdminPasswordReset) -> None:
    """사용자 비밀번호를 초기화한다. 404: 사용자 없음."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = get_password_hash(data.new_password)
    await db.commit()
