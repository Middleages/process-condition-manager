import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_active_user
from app.models import Project, ExportSystem
from app.models.project import ProjectLayer
from app.models.user import User
from app.schemas.export import (
    ExportHistoryListResponse,
    ExportRequest,
    ExportSystemResponse,
    ExportPreviewResponse,
    ExportValidationRequest,
    ExportValidationResponse,
)
from app.services.export_history_service import ExportHistoryService
from app.services.export_service import ExportService
from app.services.export_validation_service import ExportValidationService

router = APIRouter(tags=["export"])

_export_service = ExportService()


@router.get("/api/export/systems", response_model=list[ExportSystemResponse])
async def list_export_systems(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_active_user),
):
    """REQ-050: List all active export systems with column mapping counts."""
    return await _export_service.get_systems(db)


@router.post("/api/projects/{project_id}/export")
async def export_project(
    project_id: int,
    body: ExportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_user),
):
    """REQ-051~055: Generate Excel (single) or ZIP (multi) export for an approved project.

    Validation:
    - Project must exist (404)
    - Project status must be 'approved' (400) — REQ-052, REQ-080
    - Each system_id must exist (404) — REQ-056
    - Each system must be active (400) — REQ-057
    """
    # Check project exists
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    # Check project is approved — REQ-052, REQ-080
    if project.status != "approved":
        raise HTTPException(
            status_code=400,
            detail="Export is only available for approved projects.",
        )

    # Validate each system_id — REQ-056, REQ-057
    for sid in body.system_ids:
        result = await db.execute(select(ExportSystem).where(ExportSystem.id == sid))
        system = result.scalar_one_or_none()
        if not system:
            raise HTTPException(
                status_code=404,
                detail=f"Export system {sid} not found",
            )
        if not system.is_active:
            raise HTTPException(
                status_code=400,
                detail="Inactive export system cannot be used for export.",
            )

    # Count project layers (each layer = 1 row in export)
    count_result = await db.execute(
        select(func.count()).select_from(ProjectLayer).where(ProjectLayer.project_id == project_id)
    )
    total_rows: int = count_result.scalar_one()

    # Single system → Excel; multiple → ZIP — REQ-054, REQ-055
    if len(body.system_ids) == 1:
        excel_bytes, filename = await _export_service.generate(db, project_id, body.system_ids[0])

        # Log the export before returning the response
        await ExportHistoryService.log_export(
            db,
            project_id=project_id,
            export_system_id=body.system_ids[0],
            exported_by=current_user.id,
            export_type="single",
            file_count=1,
            total_rows=total_rows,
        )
        await db.commit()

        return StreamingResponse(
            io.BytesIO(excel_bytes),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    else:
        zip_bytes, zip_filename = await _export_service.generate_bulk(db, project_id, body.system_ids)

        # Log each system export separately for bulk exports
        for system_id in body.system_ids:
            await ExportHistoryService.log_export(
                db,
                project_id=project_id,
                export_system_id=system_id,
                exported_by=current_user.id,
                export_type="bulk",
                file_count=1,
                total_rows=total_rows,
            )
        await db.commit()

        return StreamingResponse(
            io.BytesIO(zip_bytes),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'},
        )


@router.get(
    "/api/projects/{project_id}/export/preview/{system_id}",
    response_model=ExportPreviewResponse,
)
async def preview_export(
    project_id: int,
    system_id: int,
    db: AsyncSession = Depends(get_db),
):
    """REQ-053: Preview first 5 rows of export as JSON.

    Validation:
    - Project must exist and be approved (same as export endpoint)
    - System must exist (404)
    """
    # Check project exists and is approved
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    if project.status != "approved":
        raise HTTPException(
            status_code=400,
            detail="Export is only available for approved projects.",
        )

    # Check system exists
    result = await db.execute(select(ExportSystem).where(ExportSystem.id == system_id))
    system = result.scalar_one_or_none()
    if not system:
        raise HTTPException(status_code=404, detail=f"Export system {system_id} not found")

    preview_data = await _export_service.generate_preview(db, project_id, system_id, limit=5)
    return ExportPreviewResponse(**preview_data)


@router.post(
    "/api/projects/{project_id}/export/validate",
    response_model=ExportValidationResponse,
)
async def validate_export(
    project_id: int,
    data: ExportValidationRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_active_user),
):
    """Validate export readiness for a project against one or more export systems.

    Returns per-system validation results containing errors and warnings:
    - ERROR: required columns with empty values
    - ERROR: mapping references a non-existent column definition
    - WARNING: non-numeric value in a numeric-typed column
    - WARNING: layer data missing rate exceeds 50%
    """
    return await ExportValidationService.validate(db, project_id, data.system_ids)


@router.get(
    "/api/projects/{project_id}/export/history",
    response_model=ExportHistoryListResponse,
)
async def get_export_history(
    project_id: int,
    offset: int = 0,
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_active_user),
):
    """Return paginated export history for a specific project."""
    # Verify project exists
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    items, total = await ExportHistoryService.get_project_history(
        db, project_id, offset=offset, limit=limit
    )
    return ExportHistoryListResponse(items=items, total=total)
