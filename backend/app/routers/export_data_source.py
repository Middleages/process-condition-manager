"""Admin router for ExportDataSource CRUD and column discovery endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_admin
from app.models.user import User
from app.schemas.export_data_source import (
    ColumnInfo,
    ExportDataSourceCreate,
    ExportDataSourceResponse,
    ExportDataSourceUpdate,
)
from app.services.export_data_source_service import ExportDataSourceService

router = APIRouter(prefix="/api/admin", tags=["export-data-sources"])


@router.get("/data-sources", response_model=list[ExportDataSourceResponse])
async def list_data_sources(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all registered external data sources."""
    return await ExportDataSourceService.list_sources(db)


@router.post("/data-sources", response_model=ExportDataSourceResponse, status_code=201)
async def create_data_source(
    data: ExportDataSourceCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Register a new external data source.

    Returns 409 if source_name already exists.
    Returns 400 if the referenced table does not exist in the database.
    """
    return await ExportDataSourceService.create_source(db, data)


@router.put("/data-sources/{source_id}", response_model=ExportDataSourceResponse)
async def update_data_source(
    source_id: int,
    data: ExportDataSourceUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update an existing external data source registration.

    Returns 404 if not found, 409 on name conflict, 400 on missing table.
    """
    return await ExportDataSourceService.update_source(db, source_id, data)


@router.delete("/data-sources/{source_id}", status_code=200)
async def delete_data_source(
    source_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Delete or soft-delete an external data source.

    Performs a hard delete when no export mappings reference this source.
    Falls back to soft delete (is_active=False) when mappings exist.
    Returns 404 if not found.
    """
    return await ExportDataSourceService.delete_source(db, source_id)


@router.get("/data-sources/{source_id}/columns", response_model=list[ColumnInfo])
async def discover_data_source_columns(
    source_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Discover columns from the registered external table via information_schema.

    Returns 404 if the data source record is not found.
    Returns 400 if the table no longer exists in the database.
    """
    return await ExportDataSourceService.discover_columns(db, source_id)
