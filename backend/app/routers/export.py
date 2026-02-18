import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Project, ExportSystem
from app.schemas.export import ExportRequest, ExportSystemResponse, ExportPreviewResponse
from app.services.export_service import ExportService

router = APIRouter(tags=["export"])

_export_service = ExportService()


@router.get("/api/export/systems", response_model=list[ExportSystemResponse])
async def list_export_systems(db: AsyncSession = Depends(get_db)):
    """REQ-050: List all active export systems with column mapping counts."""
    return await _export_service.get_systems(db)


@router.post("/api/projects/{project_id}/export")
async def export_project(
    project_id: int,
    body: ExportRequest,
    db: AsyncSession = Depends(get_db),
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

    # Single system → Excel; multiple → ZIP — REQ-054, REQ-055
    if len(body.system_ids) == 1:
        excel_bytes, filename = await _export_service.generate(db, project_id, body.system_ids[0])
        return StreamingResponse(
            io.BytesIO(excel_bytes),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    else:
        zip_bytes, zip_filename = await _export_service.generate_bulk(db, project_id, body.system_ids)
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
