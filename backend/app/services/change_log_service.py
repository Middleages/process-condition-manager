from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models import ChangeLog, Project, ProjectLayer, User
from app.models.product import Layer
from app.schemas.project import ChangeLogResponse, ChangeLogListResponse


async def get_change_logs(
    db: AsyncSession,
    project_id: int,
    *,
    layer_id: int | None = None,
    column_name: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> ChangeLogListResponse:
    """Fetch change logs for a project with optional filters."""

    # Verify project exists
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    # Get all project_layer IDs for this project
    pl_query = select(ProjectLayer.id, Layer.layer_name).join(
        Layer, ProjectLayer.layer_id == Layer.id
    ).where(ProjectLayer.project_id == project_id)

    if layer_id is not None:
        pl_query = pl_query.where(ProjectLayer.layer_id == layer_id)

    pl_result = await db.execute(pl_query)
    pl_rows = pl_result.all()
    pl_ids = [row[0] for row in pl_rows]
    pl_layer_names = {row[0]: row[1] for row in pl_rows}

    if not pl_ids:
        return ChangeLogListResponse(total=0, items=[])

    # Build base query
    base_filter = ChangeLog.project_layer_id.in_(pl_ids)
    if column_name:
        base_filter = base_filter & (ChangeLog.column_name == column_name)

    # Count total
    count_query = select(func.count()).select_from(ChangeLog).where(base_filter)
    total = (await db.execute(count_query)).scalar() or 0

    # Fetch items with user info
    items_query = (
        select(ChangeLog, User.display_name)
        .join(User, ChangeLog.changed_by == User.id)
        .where(base_filter)
        .order_by(ChangeLog.changed_at.desc())
        .limit(limit)
        .offset(offset)
    )

    result = await db.execute(items_query)
    rows = result.all()

    items = [
        ChangeLogResponse(
            id=log.id,
            project_layer_id=log.project_layer_id,
            layer_name=pl_layer_names.get(log.project_layer_id, ""),
            column_name=log.column_name,
            old_value=log.old_value,
            new_value=log.new_value,
            change_type=log.change_type,
            changed_by=log.changed_by,
            changed_by_name=display_name,
            changed_at=log.changed_at,
        )
        for log, display_name in rows
    ]

    return ChangeLogListResponse(total=total, items=items)
