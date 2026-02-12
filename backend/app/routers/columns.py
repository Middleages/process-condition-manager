from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import ColumnCategory, ColumnDefinition
from app.schemas.column import ColumnCategoryResponse

router = APIRouter(prefix="/api/columns", tags=["columns"])


@router.get("", response_model=list[ColumnCategoryResponse])
async def list_columns(
    category_code: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(ColumnCategory)
        .options(
            selectinload(ColumnCategory.columns)
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
