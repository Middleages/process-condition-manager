import io
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies.auth import require_active_user
from app.models import Project, ExportSystem, ColumnCategory, ColumnDefinition
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

router = APIRouter(prefix="/api/export", tags=["export"])
project_router = APIRouter(prefix="/api/projects", tags=["export"])

_export_service = ExportService()


@project_router.get("/{project_id}/export/simple")
async def export_simple(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_active_user),
) -> StreamingResponse:
    """Simple Excel export of the full condition table.

    Available for ALL project statuses (draft, review, approved, rejected, archived).
    Exports step_seq, layer_name, and all condition columns grouped by category.
    """
    # Load project with product and layers (eagerly load relationships)
    result = await db.execute(
        select(Project)
        .options(
            selectinload(Project.product),
            selectinload(Project.layers),
        )
        .where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    # Load column definitions grouped by category, sorted
    col_result = await db.execute(
        select(ColumnDefinition)
        .join(ColumnCategory, ColumnDefinition.category_id == ColumnCategory.id)
        .order_by(ColumnCategory.sort_order, ColumnDefinition.sort_order)
    )
    columns = col_result.scalars().all()

    # Sort project layers by layer sort_order
    sorted_layers = sorted(project.layers, key=lambda pl: pl.sort_order)

    # Build Excel workbook
    wb = Workbook()
    ws = wb.active or wb.create_sheet("Conditions")
    ws.title = "Conditions"

    # Header row: step_seq | layer_name | column display names
    headers = ["step_seq", "layer_name"] + [col.display_name for col in columns]
    ws.append(headers)

    # Data rows
    col_names = [col.column_name for col in columns]
    for pl in sorted_layers:
        row = [pl.step_seq, pl.layer_name]
        conditions = pl.conditions or {}
        for cn in col_names:
            val = conditions.get(cn, "")
            # Convert non-string values to string for Excel compatibility
            if val is None:
                val = ""
            row.append(val)
        ws.append(row)

    # Save to bytes
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    # Build filename
    product_name = project.product.product_name if project.product else f"project_{project_id}"
    today = date.today().strftime("%Y%m%d")
    filename = f"{product_name}_conditions_{today}.xlsx"

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/systems", response_model=list[ExportSystemResponse])
async def list_export_systems(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_active_user),
):
    """REQ-050: List all active export systems with column mapping counts."""
    return await _export_service.list_systems(db)


@project_router.post("/{project_id}/export")
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


@project_router.get(
    "/{project_id}/export/preview/{system_id}",
    response_model=ExportPreviewResponse,
)
async def preview_export(
    project_id: int,
    system_id: int,
    _user: User = Depends(require_active_user),
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


@project_router.post(
    "/{project_id}/export/validate",
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


@project_router.get(
    "/{project_id}/export/history",
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

    items, total = await ExportHistoryService.list_project_history(
        db, project_id, offset=offset, limit=limit
    )
    return ExportHistoryListResponse(items=items, total=total)
