"""Admin service for user management (CRUD, password reset, deactivation)."""

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models import User
from app.schemas.admin_user import AdminUserCreate, AdminUserUpdate, AdminPasswordReset, AdminUserResponse
from app.services.auth_service import get_password_hash


async def _count_active_admins(db: AsyncSession) -> int:
    """Count active users with admin role."""
    result = await db.execute(
        select(func.count()).select_from(User).where(
            User.role == "admin", User.is_active.is_(True)
        )
    )
    return result.scalar_one()


async def list_users(db: AsyncSession, include_inactive: bool = False) -> list[AdminUserResponse]:
    """List all users ordered by display_name. Excludes inactive users by default."""
    query = select(User).order_by(User.display_name)
    if not include_inactive:
        query = query.where(User.is_active.is_(True))
    result = await db.execute(query)
    users = result.scalars().all()
    return [AdminUserResponse.model_validate(u) for u in users]


async def create_user(db: AsyncSession, data: AdminUserCreate) -> AdminUserResponse:
    """Create a new user. Raises 409 on duplicate username or email."""
    # Check username uniqueness
    existing = await db.execute(select(User).where(User.username == data.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Username '{data.username}' already exists")

    # Check email uniqueness if provided
    if data.email:
        existing_email = await db.execute(select(User).where(User.email == data.email))
        if existing_email.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Email '{data.email}' already exists")

    user = User(
        username=data.username,
        display_name=data.display_name,
        email=data.email,
        role=data.role,
        password_hash=get_password_hash(data.password),
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return AdminUserResponse.model_validate(user)


async def update_user(db: AsyncSession, user_id: int, data: AdminUserUpdate) -> AdminUserResponse:
    """Update user fields. Raises 404 if not found."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if data.display_name is not None:
        user.display_name = data.display_name
    if data.email is not None:
        user.email = data.email
    if data.role is not None:
        if user.role == "admin" and data.role != "admin":
            admin_count = await _count_active_admins(db)
            if admin_count <= 1:
                raise HTTPException(
                    status_code=400,
                    detail="마지막 관리자의 역할을 변경할 수 없습니다",
                )
        user.role = data.role
    if data.is_active is not None:
        user.is_active = data.is_active

    await db.commit()
    await db.refresh(user)
    return AdminUserResponse.model_validate(user)


async def deactivate_user(db: AsyncSession, user_id: int, current_user_id: int) -> None:
    """Deactivate a user. Raises 400 if trying to deactivate self, 404 if not found."""
    if user_id == current_user_id:
        raise HTTPException(status_code=400, detail="자기 자신을 비활성화할 수 없습니다")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.role == "admin":
        admin_count = await _count_active_admins(db)
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="마지막 관리자를 비활성화할 수 없습니다",
            )

    user.is_active = False
    await db.commit()


async def reset_password(db: AsyncSession, user_id: int, data: AdminPasswordReset) -> None:
    """Reset user password. Raises 404 if not found."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = get_password_hash(data.new_password)
    await db.commit()
