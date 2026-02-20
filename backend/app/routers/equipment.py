"""Router for EquipmentAssignment CRUD operations."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_active_user
from app.models.user import User
from app.schemas.equipment import (
    EquipmentCreate,
    EquipmentReorderRequest,
    EquipmentResponse,
    EquipmentUpdate,
)
from app.services.equipment_service import EquipmentService

router = APIRouter(prefix="/api/projects", tags=["equipment"])

_equipment_service = EquipmentService()


@router.get(
    "/{project_id}/layers/{layer_id}/equipment",
    response_model=list[EquipmentResponse],
)
async def list_equipment(
    project_id: int,
    layer_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_active_user),
):
    """List all equipment assignments for a project-layer, ordered by sort_order."""
    return await EquipmentService.list_equipment(db, project_id, layer_id)


@router.post(
    "/{project_id}/layers/{layer_id}/equipment",
    response_model=EquipmentResponse,
    status_code=201,
)
async def create_equipment(
    project_id: int,
    layer_id: int,
    data: EquipmentCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_active_user),
):
    """Create a new equipment assignment for a project-layer."""
    return await EquipmentService.create_equipment(db, project_id, layer_id, data)


@router.put(
    "/{project_id}/layers/{layer_id}/equipment/reorder",
    response_model=list[EquipmentResponse],
)
async def reorder_equipment(
    project_id: int,
    layer_id: int,
    data: EquipmentReorderRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_active_user),
):
    """Reorder equipment assignments for a project-layer."""
    return await EquipmentService.reorder_equipment(db, project_id, layer_id, data.ordered_ids)


@router.put(
    "/{project_id}/layers/{layer_id}/equipment/{eq_id}",
    response_model=EquipmentResponse,
)
async def update_equipment(
    project_id: int,
    layer_id: int,
    eq_id: int,
    data: EquipmentUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_active_user),
):
    """Update an existing equipment assignment."""
    return await EquipmentService.update_equipment(db, project_id, layer_id, eq_id, data)


@router.delete(
    "/{project_id}/layers/{layer_id}/equipment/{eq_id}",
    response_model=None,
    status_code=204,
)
async def delete_equipment(
    project_id: int,
    layer_id: int,
    eq_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_active_user),
):
    """Delete an equipment assignment."""
    await EquipmentService.delete_equipment(db, project_id, layer_id, eq_id)
