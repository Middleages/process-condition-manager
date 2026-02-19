from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models import Project
from app.repositories import ChangeLogRepository
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

    # Fetch project_layer_id -> layer_name map (optionally filtered by layer_id)
    pl_layer_names = await ChangeLogRepository.fetch_project_layer_map(
        db, project_id, layer_id=layer_id
    )
    pl_ids = list(pl_layer_names.keys())

    if not pl_ids:
        return ChangeLogListResponse(total=0, page=page, items=[])

    # Page-to-offset conversion: use offset if > 0, otherwise use page-based pagination
    effective_offset = offset if offset > 0 else (page - 1) * limit

    rows, total = await ChangeLogRepository.fetch_change_logs(
        db,
        pl_ids,
        column_name=column_name,
        change_type=change_type,
        changed_by=changed_by,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=effective_offset,
    )

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

    # Fetch project_layer_id -> layer_name map (optionally filtered by layer_id)
    pl_layer_names = await ChangeLogRepository.fetch_project_layer_map(
        db, project_id, layer_id=layer_id
    )
    pl_ids = list(pl_layer_names.keys())

    all_entries: list[TimelineEntry] = []

    # Fetch change_logs with user join
    if pl_ids:
        cl_rows = await ChangeLogRepository.fetch_change_logs(
            db,
            pl_ids,
            change_type=change_type,
            changed_by=changed_by,
            limit=10_000_000,  # fetch all for in-memory merge
            offset=0,
        )
        rows, _ = cl_rows
        for log, display_name in rows:
            entry = TimelineEntry(
                id=f"change-{log.id}",
                entry_type="cell_change",
                timestamp=log.changed_at,
                user_id=log.changed_by,
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

    # When change_type filter is active (manual/backbone/recipe), exclude status_change entries
    cell_change_types = {"manual", "backbone", "recipe"}
    include_status_changes = change_type is None or change_type not in cell_change_types

    if include_status_changes:
        sl_rows = await ChangeLogRepository.fetch_status_logs(
            db, project_id, changed_by=changed_by
        )
        for log, display_name, user_id in sl_rows:
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
    page_offset = (page - 1) * limit
    paginated_entries = all_entries[page_offset: page_offset + limit]

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

    # Verify project_layer_id belongs to this project and get layer_name
    pl_layer_names = await ChangeLogRepository.fetch_project_layer_map(db, project_id)
    if project_layer_id not in pl_layer_names:
        raise HTTPException(404, "Project layer not found in this project")

    layer_name = pl_layer_names[project_layer_id]

    rows = await ChangeLogRepository.fetch_cell_history(db, project_layer_id, column_name)

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
