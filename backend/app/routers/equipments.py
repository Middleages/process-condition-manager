"""Public equipment router for listing active equipments per line."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_active_user
from app.models.equipment import Equipment
from app.models.user import User
from app.schemas.admin_master import EquipmentPublicResponse

router = APIRouter(prefix="/equipments", tags=["equipments"])


@router.get("", response_model=list[EquipmentPublicResponse])
async def list_active_equipments(
    line_id: int = Query(..., description="Line ID to filter equipments"),
    _user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
):
    """List active equipments for a given line, ordered by sort_order."""
    query = (
        select(Equipment)
        .where(Equipment.line_id == line_id, Equipment.is_active == True)  # noqa: E712
        .order_by(Equipment.sort_order)
    )
    result = await db.execute(query)
    equipments = result.scalars().all()
    return [EquipmentPublicResponse.model_validate(eqp) for eqp in equipments]
