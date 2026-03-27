from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_active_user
from app.models.user import User
from app.schemas.export import ExportSystemResponse
from app.services.export_service import ExportService

router = APIRouter(prefix="/export", tags=["export"])

_export_service = ExportService()


@router.get("/systems", response_model=list[ExportSystemResponse])
async def list_export_systems(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_active_user),
):
    """REQ-050: List all active export systems with column mapping counts."""
    return await _export_service.list_systems(db)
