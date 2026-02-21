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
    StatusHistoryItem,
    StatusHistoryResponse,
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
        raise HTTPException(status_code=404, detail="Project not found")

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

    Uses a UNION ALL query (DB-side sort + pagination) to avoid loading all
    records into memory.

    Optional filters:
    - layer_id: filter by layer (matched via project_layers.layer_id)
    - change_type: filter by change type (manual/backbone/recipe); when active,
      status_change entries are excluded
    - changed_by: filter by user ID
    """

    # Verify project exists
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Fetch project_layer_id -> layer_name map (optionally filtered by layer_id)
    pl_layer_names = await ChangeLogRepository.fetch_project_layer_map(
        db, project_id, layer_id=layer_id
    )
    pl_ids = list(pl_layer_names.keys())

    # When change_type filter is active (manual/backbone/recipe), exclude status_change entries
    cell_change_types = {"manual", "backbone", "recipe"}
    include_status_changes = change_type is None or change_type not in cell_change_types

    # DB-side UNION ALL merge with pagination
    page_offset = (page - 1) * limit
    raw_rows, total = await ChangeLogRepository.fetch_timeline(
        db,
        project_id,
        pl_ids,
        change_type=change_type,
        changed_by=changed_by,
        include_status_changes=include_status_changes,
        limit=limit,
        offset=page_offset,
    )

    # Build TimelineEntry objects from raw row dicts
    paginated_entries: list[TimelineEntry] = []
    for row in raw_rows:
        entry_type = row["entry_type"]
        if entry_type == "cell_change":
            entry = TimelineEntry(
                id=f"change-{row['row_id']}",
                entry_type="cell_change",
                timestamp=row["timestamp"],
                user_id=row["user_id"],
                user_name=row["user_name"],
                details=TimelineEntryDetails(
                    layer_name=row.get("layer_name") or "",
                    column_name=row.get("column_name"),
                    old_value=row.get("old_value"),
                    new_value=row.get("new_value"),
                    change_type=row.get("change_type_val"),
                ),
            )
        else:
            entry = TimelineEntry(
                id=f"status-{row['row_id']}",
                entry_type="status_change",
                timestamp=row["timestamp"],
                user_id=row["user_id"],
                user_name=row["user_name"],
                details=TimelineEntryDetails(
                    from_status=row.get("from_status"),
                    to_status=row.get("to_status"),
                    comment=row.get("comment"),
                ),
            )
        paginated_entries.append(entry)

    # Group by date (YYYY-MM-DD) — rows are already sorted DESC by the DB
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
        raise HTTPException(status_code=404, detail="Project not found")

    # Verify project_layer_id belongs to this project and get layer_name
    pl_layer_names = await ChangeLogRepository.fetch_project_layer_map(db, project_id)
    if project_layer_id not in pl_layer_names:
        raise HTTPException(status_code=404, detail="Project layer not found in this project")

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


async def get_status_history(
    db: AsyncSession,
    project_id: int,
) -> StatusHistoryResponse:
    """Get status change history for a project.

    Args:
        db: Database session
        project_id: Project ID to query status logs for

    Returns:
        StatusHistoryResponse with history list sorted by changed_at DESC
    """
    rows = await ChangeLogRepository.fetch_status_logs(db, project_id)

    history = [
        StatusHistoryItem(
            id=log.id,
            from_status=log.from_status,
            to_status=log.to_status,
            changed_by=log.changed_by,
            changer_name=display_name,
            comment=log.comment,
            changed_at=log.changed_at,
        )
        for log, display_name, _user_id in rows
    ]

    # Sort by changed_at DESC (fetch_status_logs does not guarantee order)
    history.sort(key=lambda h: h.changed_at, reverse=True)

    return StatusHistoryResponse(history=history)
