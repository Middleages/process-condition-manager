"""Admin router for ExportSystem and ExportColumnMapping CRUD operations."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_admin
from app.models.user import User
from app.services.export_admin_service import ExportAdminService
from app.schemas.export_admin import (
    ExportSystemCreate,
    ExportSystemUpdate,
    ExportSystemAdminResponse,
    ExportMappingCreate,
    ExportMappingUpdate,
    ExportMappingResponse,
    MappingReorderRequest,
)

router = APIRouter(prefix="/api/admin", tags=["export-admin"])


# ---------------------------------------------------------------------------
# ExportSystem endpoints
# ---------------------------------------------------------------------------

@router.get("/export-systems", response_model=list[ExportSystemAdminResponse])
async def list_export_systems(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all export systems (including inactive) with column count."""
    return await ExportAdminService.list_systems(db)


@router.post("/export-systems", response_model=ExportSystemAdminResponse, status_code=201)
async def create_export_system(
    data: ExportSystemCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Create a new export system. Returns 409 if system_name already exists."""
    return await ExportAdminService.create_system(db, data)


@router.put("/export-systems/{system_id}", response_model=ExportSystemAdminResponse)
async def update_export_system(
    system_id: int,
    data: ExportSystemUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update an existing export system. Returns 404 if not found, 409 on name conflict."""
    return await ExportAdminService.update_system(db, system_id, data)


@router.delete("/export-systems/{system_id}", status_code=204, response_model=None)
async def delete_export_system(
    system_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Delete an export system. CASCADE removes associated mappings."""
    await ExportAdminService.delete_system(db, system_id)


# ---------------------------------------------------------------------------
# ExportColumnMapping endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/export-systems/{system_id}/mappings",
    response_model=list[ExportMappingResponse],
)
async def list_export_mappings(
    system_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all column mappings for an export system ordered by sort_order."""
    return await ExportAdminService.list_mappings(db, system_id)


@router.post(
    "/export-systems/{system_id}/mappings",
    response_model=ExportMappingResponse,
    status_code=201,
)
async def create_export_mapping(
    system_id: int,
    data: ExportMappingCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Create a new column mapping for an export system. Auto-assigns sort_order."""
    return await ExportAdminService.create_mapping(db, system_id, data)


@router.put(
    "/export-systems/{system_id}/mappings/{mapping_id}",
    response_model=ExportMappingResponse,
)
async def update_export_mapping(
    system_id: int,
    mapping_id: int,
    data: ExportMappingUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update a column mapping. Returns 404 if system or mapping not found."""
    return await ExportAdminService.update_mapping(db, system_id, mapping_id, data)


@router.delete(
    "/export-systems/{system_id}/mappings/{mapping_id}",
    status_code=204,
    response_model=None,
)
async def delete_export_mapping(
    system_id: int,
    mapping_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Delete a column mapping. Returns 404 if system or mapping not found."""
    await ExportAdminService.delete_mapping(db, system_id, mapping_id)


@router.put(
    "/export-systems/{system_id}/mappings/reorder",
    response_model=list[ExportMappingResponse],
)
async def reorder_export_mappings(
    system_id: int,
    data: MappingReorderRequest,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Reorder column mappings by providing an ordered list of mapping IDs."""
    return await ExportAdminService.reorder_mappings(db, system_id, data.ordered_ids)
