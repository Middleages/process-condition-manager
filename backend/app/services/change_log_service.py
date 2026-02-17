from datetime import datetime
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models import ChangeLog, Project, ProjectLayer, User, ProjectStatusLog
from app.models.product import Layer
from app.schemas.project import (
    ChangeLogResponse,
    ChangeLogListResponse,
    TimelineEntry,
    TimelineEntryDetails,
    TimelineGroup,
    TimelineResponse,
    CellHistoryItem,
    CellHistoryResponse,
)


async def get_change_logs(
    db: AsyncSession,
    project_id: int,
    *,
    layer_id: int | None = None,
    column_name: str | None = None,
    limit: int = 50,
    offset: int = 0,
    change_type: str | None = None,
    changed_by: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    page: int = 1,
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
        return ChangeLogListResponse(total=0, page=page, items=[])

    # Build base query
    base_filter = ChangeLog.project_layer_id.in_(pl_ids)
    if column_name:
        base_filter = base_filter & (ChangeLog.column_name == column_name)
    if change_type:
        base_filter = base_filter & (ChangeLog.change_type == change_type)
    if changed_by:
        base_filter = base_filter & (ChangeLog.changed_by == changed_by)
    if date_from:
        base_filter = base_filter & (ChangeLog.changed_at >= date_from)
    if date_to:
        base_filter = base_filter & (ChangeLog.changed_at <= date_to)

    # Page-to-offset conversion: use offset if > 0, otherwise use page-based pagination
    effective_offset = offset if offset > 0 else (page - 1) * limit

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
        .offset(effective_offset)
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

    return ChangeLogListResponse(total=total, page=page, items=items)


async def get_timeline(
    db: AsyncSession,
    project_id: int,
    *,
    page: int = 1,
    limit: int = 50,
    layer_id: int | None = None,
    change_type: str | None = None,
    changed_by: int | None = None,
) -> TimelineResponse:
    """Get a merged timeline of cell changes and status changes for a project.

    Optional filters:
    - layer_id: filter by layer (matched via project_layers.layer_id)
    - change_type: filter by change type (manual/backbone/recipe); when active,
      status_change entries are excluded
    - changed_by: filter by user ID
    """

    # Verify project exists
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    # Get project_layer_ids with layer names, optionally filtered by layer_id
    pl_query = select(ProjectLayer.id, Layer.layer_name).join(
        Layer, ProjectLayer.layer_id == Layer.id
    ).where(ProjectLayer.project_id == project_id)

    if layer_id is not None:
        pl_query = pl_query.where(ProjectLayer.layer_id == layer_id)

    pl_result = await db.execute(pl_query)
    pl_rows = pl_result.all()
    pl_ids = [row[0] for row in pl_rows]
    pl_layer_names = {row[0]: row[1] for row in pl_rows}

    all_entries: list[TimelineEntry] = []

    # Query change_logs with user join
    if pl_ids:
        cl_query = (
            select(ChangeLog, User.display_name, User.id)
            .join(User, ChangeLog.changed_by == User.id)
            .where(ChangeLog.project_layer_id.in_(pl_ids))
        )
        if change_type is not None:
            cl_query = cl_query.where(ChangeLog.change_type == change_type)
        if changed_by is not None:
            cl_query = cl_query.where(ChangeLog.changed_by == changed_by)

        cl_result = await db.execute(cl_query)
        for log, display_name, user_id in cl_result.all():
            entry = TimelineEntry(
                id=f"change-{log.id}",
                entry_type="cell_change",
                timestamp=log.changed_at,
                user_id=user_id,
                user_name=display_name,
                details=TimelineEntryDetails(
                    layer_name=pl_layer_names.get(log.project_layer_id, ""),
                    column_name=log.column_name,
                    old_value=log.old_value,
                    new_value=log.new_value,
                    change_type=log.change_type,
                ),
            )
            all_entries.append(entry)

    # Query project_status_logs with user join
    # When change_type filter is active (manual/backbone/recipe), exclude status_change entries
    cell_change_types = {"manual", "backbone", "recipe"}
    include_status_changes = change_type is None or change_type not in cell_change_types

    if include_status_changes:
        sl_query = (
            select(ProjectStatusLog, User.display_name, User.id)
            .join(User, ProjectStatusLog.changed_by == User.id)
            .where(ProjectStatusLog.project_id == project_id)
        )
        if changed_by is not None:
            sl_query = sl_query.where(ProjectStatusLog.changed_by == changed_by)

        sl_result = await db.execute(sl_query)
        for log, display_name, user_id in sl_result.all():
            entry = TimelineEntry(
                id=f"status-{log.id}",
                entry_type="status_change",
                timestamp=log.changed_at,
                user_id=user_id,
                user_name=display_name,
                details=TimelineEntryDetails(
                    from_status=log.from_status,
                    to_status=log.to_status,
                    comment=log.comment,
                ),
            )
            all_entries.append(entry)

    # Sort all entries by timestamp DESC
    all_entries.sort(key=lambda e: e.timestamp, reverse=True)

    total = len(all_entries)

    # Apply pagination
    offset = (page - 1) * limit
    paginated_entries = all_entries[offset: offset + limit]

    # Group by date (YYYY-MM-DD)
    groups_dict: dict[str, list[TimelineEntry]] = {}
    for entry in paginated_entries:
        date_str = entry.timestamp.strftime("%Y-%m-%d")
        if date_str not in groups_dict:
            groups_dict[date_str] = []
        groups_dict[date_str].append(entry)

    groups = [
        TimelineGroup(date=date_str, entries=entries)
        for date_str, entries in groups_dict.items()
    ]

    return TimelineResponse(total=total, page=page, limit=limit, groups=groups)


async def get_cell_history(
    db: AsyncSession,
    project_id: int,
    *,
    project_layer_id: int,
    column_name: str,
) -> CellHistoryResponse:
    """Get full change history for a specific cell (project_layer + column)."""

    # Verify project exists
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    # Verify project_layer_id belongs to this project, get layer_name
    pl_query = (
        select(ProjectLayer.id, Layer.layer_name)
        .join(Layer, ProjectLayer.layer_id == Layer.id)
        .where(
            ProjectLayer.id == project_layer_id,
            ProjectLayer.project_id == project_id,
        )
    )
    pl_result = await db.execute(pl_query)
    pl_row = pl_result.first()
    if not pl_row:
        raise HTTPException(404, "Project layer not found in this project")

    layer_name = pl_row[1]

    # Query change_logs filtered by project_layer_id + column_name
    cl_query = (
        select(ChangeLog, User.display_name)
        .join(User, ChangeLog.changed_by == User.id)
        .where(
            ChangeLog.project_layer_id == project_layer_id,
            ChangeLog.column_name == column_name,
        )
        .order_by(ChangeLog.changed_at.desc())
    )
    cl_result = await db.execute(cl_query)
    rows = cl_result.all()

    items = [
        CellHistoryItem(
            id=log.id,
            old_value=log.old_value,
            new_value=log.new_value,
            change_type=log.change_type,
            changed_by=log.changed_by,
            changed_by_name=display_name,
            changed_at=log.changed_at,
        )
        for log, display_name in rows
    ]

    return CellHistoryResponse(
        project_layer_id=project_layer_id,
        layer_name=layer_name,
        column_name=column_name,
        total=len(items),
        items=items,
    )
