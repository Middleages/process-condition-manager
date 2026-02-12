from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Line
from app.schemas.line import LineResponse

router = APIRouter(prefix="/api/lines", tags=["lines"])


@router.get("", response_model=list[LineResponse])
async def list_lines(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Line).order_by(Line.line_code))
    return result.scalars().all()
