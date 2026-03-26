from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import get_current_user
from app.models import User
from app.schemas.user import UserResponse

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserResponse])
async def list_users(
    role: str | None = None,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(User).where(User.is_active == True).order_by(User.display_name)  # noqa: E712
    if role:
        # ARRAY 컬럼에서 특정 역할 포함 여부를 확인 (contains 연산)
        query = query.where(User.roles.contains([role]))
    result = await db.execute(query)
    return result.scalars().all()
