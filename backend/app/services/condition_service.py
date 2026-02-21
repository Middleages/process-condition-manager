from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models import Project, ProjectLayer, ChangeLog
from app.schemas.project import BulkSaveRequest, BulkSaveResponse
from app.utils.comparison import values_differ


async def bulk_save_conditions(
    db: AsyncSession,
    project_id: int,
    request: BulkSaveRequest,
) -> BulkSaveResponse:
    """Save all modified conditions with server-side diff and change_log creation."""

    # 1. Load project and validate status
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status != "draft":
        raise HTTPException(status_code=400, detail="Can only edit draft projects")

    # 2. Conflict detection
    if project.updated_at and request.expected_updated_at:
        server_time = project.updated_at.replace(tzinfo=timezone.utc) if project.updated_at.tzinfo is None else project.updated_at
        client_time = request.expected_updated_at.replace(tzinfo=timezone.utc) if request.expected_updated_at.tzinfo is None else request.expected_updated_at
        if server_time > client_time:
            raise HTTPException(
                status_code=409,
                detail=f"Project has been modified by another user. Server updated_at: {project.updated_at.isoformat()}"
            )

    # 3. Load existing project_layers
    result = await db.execute(
        select(ProjectLayer)
        .where(ProjectLayer.project_id == project_id)
    )
    existing_layers = result.scalars().all()
    existing_map: dict[int, ProjectLayer] = {pl.id: pl for pl in existing_layers}

    # 4. Process each layer update
    total_change_logs = 0

    for layer_update in request.layers:
        pl_id = layer_update.project_layer_id
        new_conditions = layer_update.conditions

        if pl_id not in existing_map:
            raise HTTPException(status_code=400, detail=f"Invalid project_layer_id: {pl_id}")

        existing_pl = existing_map[pl_id]
        old_conditions = existing_pl.conditions or {}

        # Server-side diff
        all_keys = set(old_conditions.keys()) | set(new_conditions.keys())
        for key in all_keys:
            old_val = old_conditions.get(key)
            new_val = new_conditions.get(key)

            if values_differ(old_val, new_val):
                change_log = ChangeLog(
                    project_layer_id=pl_id,
                    column_name=key,
                    old_value=str(old_val) if old_val is not None else None,
                    new_value=str(new_val) if new_val is not None else None,
                    change_type="manual",
                    changed_by=request.updated_by,
                )
                db.add(change_log)
                total_change_logs += 1

        # Update conditions (full reassignment for JSONB mutation detection)
        existing_pl.conditions = new_conditions

    # 5. Touch project.updated_at
    project.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(project)

    return BulkSaveResponse(
        success=True,
        updated_layers=len(request.layers),
        change_log_count=total_change_logs,
        updated_at=project.updated_at,
    )


async def get_project_conditions(
    db: AsyncSession,
    project_id: int,
) -> list[ProjectLayer]:
    """Return all project_layers for a project with layer info."""
    # Verify project exists
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    result = await db.execute(
        select(ProjectLayer)
        .options(
            selectinload(ProjectLayer.layer),
            selectinload(ProjectLayer.backbone_product),
        )
        .where(ProjectLayer.project_id == project_id)
        .order_by(ProjectLayer.sort_order)
    )
    return list(result.scalars().all())
