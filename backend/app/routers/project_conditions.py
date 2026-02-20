from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.dependencies.auth import get_current_user, require_project_owner
from app.schemas.project import (
    BulkSaveRequest,
    BulkSaveResponse,
    ValidationResponse,
    ChangeLogListResponse,
    TimelineResponse,
    CellHistoryResponse,
    VersionHistoryResponse,
    VersionDiffResponse,
)
from app.services import condition_service, validation_service, change_log_service
from app.services import project_analytics_service, diff_service

router = APIRouter(prefix="/api/projects", tags=["project-conditions"])


@router.put("/{project_id}/conditions", response_model=BulkSaveResponse)
async def save_conditions(
    project_id: int,
    request: BulkSaveRequest,
    current_user: User = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    return await condition_service.bulk_save_conditions(db, project_id, request)


@router.post("/{project_id}/validate", response_model=ValidationResponse)
async def validate_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await validation_service.validate_project(db, project_id)


@router.get("/{project_id}/change-logs", response_model=ChangeLogListResponse)
async def get_change_logs(
    project_id: int,
    layer_id: int | None = Query(None, description="Filter by layer_id"),
    column_name: str | None = Query(None, description="Filter by column_name"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    change_type: str | None = Query(None, description="Filter by change_type (manual/backbone/recipe)"),
    changed_by: int | None = Query(None, description="Filter by user ID"),
    date_from: datetime | None = Query(None, description="Filter changes from this datetime"),
    date_to: datetime | None = Query(None, description="Filter changes to this datetime"),
    page: int = Query(1, ge=1, description="Page number for pagination"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await change_log_service.get_change_logs(
        db, project_id, layer_id=layer_id, column_name=column_name,
        limit=limit, offset=offset, change_type=change_type,
        changed_by=changed_by, date_from=date_from, date_to=date_to, page=page,
    )


@router.get("/{project_id}/changelog/timeline", response_model=TimelineResponse)
async def get_timeline(
    project_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    layer_id: int | None = Query(None, description="Filter by layer ID"),
    change_type: str | None = Query(None, description="Filter by change type: manual, backbone, recipe"),
    changed_by: int | None = Query(None, description="Filter by user ID"),
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await change_log_service.get_timeline(
        db, project_id,
        page=page,
        limit=limit,
        layer_id=layer_id,
        change_type=change_type,
        changed_by=changed_by,
    )


@router.get("/{project_id}/changelog/cell", response_model=CellHistoryResponse)
async def get_cell_history(
    project_id: int,
    project_layer_id: int = Query(..., description="Project layer ID"),
    column_name: str = Query(..., description="Column name"),
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await change_log_service.get_cell_history(
        db, project_id, project_layer_id=project_layer_id, column_name=column_name,
    )


@router.get("/{project_id}/versions", response_model=VersionHistoryResponse)
async def get_version_history(
    project_id: int,
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await project_analytics_service.get_version_history(db, project_id)


@router.get("/{project_id}/versions/{compare_project_id}/diff", response_model=VersionDiffResponse)
async def get_version_diff(
    project_id: int,
    compare_project_id: int,
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await diff_service.get_version_diff(db, project_id, compare_project_id)
