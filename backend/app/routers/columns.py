from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies.auth import get_current_user
from app.models import ColumnCategory, ColumnDefinition
from app.models.user import User
from app.schemas.column import ColumnCategoryResponse

router = APIRouter(prefix="/columns", tags=["columns"])


@router.get("", response_model=list[ColumnCategoryResponse])
async def list_columns(
    category_code: str | None = None,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 사용자 노출용: use_yn=True 인 컬럼만 반환 (비공개 컬럼은 테스트 단계로 간주)
    query = (
        select(ColumnCategory)
        .options(
            selectinload(ColumnCategory.columns.and_(ColumnDefinition.use_yn.is_(True)))
            .selectinload(ColumnDefinition.validations)
        )
        .order_by(ColumnCategory.sort_order)
    )
    if category_code:
        query = query.where(ColumnCategory.category_code == category_code)
    result = await db.execute(query)
    categories = result.scalars().unique().all()

    # Sort columns within each category
    for cat in categories:
        cat.columns.sort(key=lambda c: c.sort_order)

    return categories
