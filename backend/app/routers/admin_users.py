"""Admin router for user management."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.dependencies.auth import require_admin
from app.schemas.admin_user import AdminUserCreate, AdminUserUpdate, AdminUserResponse, AdminPasswordReset
from app.services import admin_user_service

router = APIRouter(prefix="/api/admin", tags=["admin-users"])


@router.get("/users", response_model=list[AdminUserResponse])
async def list_users(
    include_inactive: bool = Query(False, description="Include inactive users"),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all users (admin only)."""
    return await admin_user_service.list_users(db, include_inactive=include_inactive)


@router.post("/users", response_model=AdminUserResponse, status_code=201)
async def create_user(
    data: AdminUserCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Create a new user (admin only)."""
    return await admin_user_service.create_user(db, data)


@router.put("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: int,
    data: AdminUserUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update user details (admin only)."""
    return await admin_user_service.update_user(db, user_id, data)


@router.put("/users/{user_id}/deactivate", status_code=200)
async def deactivate_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Deactivate a user (admin only). Cannot deactivate self."""
    await admin_user_service.deactivate_user(db, user_id, current_user_id=admin.id)
    return {"message": "User deactivated"}


@router.put("/users/{user_id}/password", status_code=200)
async def reset_password(
    user_id: int,
    data: AdminPasswordReset,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Reset user password (admin only)."""
    await admin_user_service.reset_password(db, user_id, data)
    return {"message": "Password reset successful"}
