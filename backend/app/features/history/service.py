"""Read-only orchestration for public history endpoints."""

from __future__ import annotations

from app.core.errors import NotFoundError
from app.features.history.cursor import (
    HistoryCellHistoryCursor,
    HistoryDetailScope,
    HistoryMemberFilterScope,
    HistoryTimelineCursor,
    HistoryTimelineScope,
    decode_history_cell_history_cursor,
    decode_history_detail_cursor,
    decode_history_detail_scope,
    decode_history_timeline_cursor,
    encode_history_cell_history_cursor,
    encode_history_detail_scope,
    encode_history_timeline_cursor,
    ensure_history_scope_matches,
)
from app.features.history.projection import project_cell_detail
from app.features.history.repository import HistoryRepository, HistoryTimelineGroupRow
from app.features.history.schema import (
    HistoryCellHistoryItemOut,
    HistoryCellHistoryOut,
    HistoryCellHistoryQueryIn,
    HistoryCoverageOut,
    HistoryDetailItemOut,
    HistoryDetailOut,
    HistoryDetailQueryIn,
    HistoryJumpTargetOut,
    HistoryStateEntryOut,
    HistoryTimelineItemOut,
    HistoryTimelineOut,
    HistoryTimelineQueryIn,
)

_ORIGINS = {"manual", "paste", "backbone", "system"}
_DETAIL_EVENT_TYPES = {"cell_update"}
_CAPTURE_EVENT_TYPES = {"backbone_copy", "backbone_layer_replace"}


class HistoryService:
    """Coordinate bounded history reads without mutating the session."""

    def __init__(self, repo: HistoryRepository) -> None:
        self.repo = repo

    async def list_events(
        self, project_id: int, query: HistoryTimelineQueryIn
    ) -> HistoryTimelineOut:
        if not await self.repo.project_exists(project_id):
            raise NotFoundError(f"project not found: {project_id}")

        member_filters = _member_filters(query)
        scope = HistoryTimelineScope(project_id=project_id, member_filters=member_filters)
        if query.cursor is None:
            snapshot_max_event_id = await self.repo.snapshot_max_event_id(
                project_id, member_filters=member_filters
            )
            before_group_max_id = None
        else:
            cursor = decode_history_timeline_cursor(query.cursor, expected_scope=scope)
            snapshot_max_event_id = cursor.snapshot_max_event_id
            before_group_max_id = cursor.before_group_max_id

        groups = await self.repo.list_timeline_groups(
            project_id,
            member_filters=member_filters,
            snapshot_max_event_id=snapshot_max_event_id,
            before_group_max_id=before_group_max_id,
            limit=query.limit + 1,
        )
        page = groups[: query.limit]
        coverage = await self.repo.coverage_counts(
            project_id, snapshot_max_event_id=snapshot_max_event_id
        )
        next_cursor = None
        if len(groups) > query.limit and snapshot_max_event_id is not None and page:
            next_cursor = encode_history_timeline_cursor(
                HistoryTimelineCursor(
                    version=1,
                    snapshot_max_event_id=snapshot_max_event_id,
                    before_group_max_id=page[-1].max_event_id,
                    scope=scope,
                )
            )
        return HistoryTimelineOut(
            items=[_timeline_item(project_id, member_filters, group) for group in page],
            coverage=HistoryCoverageOut(
                legacy_unresolved_layer_count=coverage.legacy_unresolved_layer_count,
                legacy_detail_unavailable_count=coverage.legacy_detail_unavailable_count,
            ),
            next_cursor=next_cursor,
        )

    async def get_batch(
        self, project_id: int, batch_id: str, query: HistoryDetailQueryIn
    ) -> HistoryDetailOut:
        scope = decode_history_detail_scope(query.scope)
        ensure_history_scope_matches(
            HistoryDetailScope(
                project_id=project_id,
                batch_id=batch_id,
                member_filters=scope.member_filters,
            ),
            scope,
        )
        cursor = (
            decode_history_detail_cursor(query.cursor, expected_scope=scope)
            if query.cursor is not None
            else None
        )
        if not await self.repo.project_exists(project_id):
            raise NotFoundError(f"project not found: {project_id}")
        total = await self.repo.count_batch_members(project_id, batch_id)
        if total == 0:
            raise NotFoundError(f"event batch not found: {batch_id}")

        before_event_id = cursor.last_event_id if cursor is not None else None
        rows = await self.repo.load_batch_members(
            project_id,
            batch_id,
            member_filters=scope.member_filters,
            before_event_id=before_event_id,
            limit=query.limit + 1,
        )
        page = rows[: query.limit]
        projection = project_cell_detail(page)
        next_cursor = None
        if len(rows) > query.limit and page:
            from app.features.history.cursor import HistoryDetailCursor, encode_history_detail_cursor

            next_cursor = encode_history_detail_cursor(
                HistoryDetailCursor(
                    version=1,
                    scope=scope,
                    order_kind="event_desc",
                    last_event_id=page[-1].event_id,
                )
            )
        return HistoryDetailOut(
            order_kind="event_desc",
            detail_status=projection.availability.value,
            items=[
                HistoryDetailItemOut(
                    event_id=item.event_id,
                    old_code=item.old_value,
                    new_code=item.new_value,
                    actor=item.actor,
                    origin=_origin(page[index].origin),
                    created_at=page[index].created_at,
                    layer_key=item.layer_key,
                    jump_target=HistoryJumpTargetOut(
                        layer_key=item.layer_key,
                        condition_id=item.condition_id,
                        parameter_code=item.parameter_code,
                        jump_status="deleted" if item.jump_state.value == "deleted" else "available",
                    ),
                )
                for index, item in enumerate(projection.items)
                if page[index].created_at is not None
            ],
            next_cursor=next_cursor,
        )

    async def get_cell_history(
        self, project_id: int, query: HistoryCellHistoryQueryIn
    ) -> HistoryCellHistoryOut:
        if query.cursor is not None:
            cursor = decode_history_cell_history_cursor(
                query.cursor,
                expected_project_id=project_id,
                expected_condition_id=query.condition_id,
                expected_parameter_code=query.parameter_code,
            )
            snapshot_max_event_id = cursor.last_event_id - 1
        else:
            snapshot_max_event_id = None
        if not await self.repo.project_exists(project_id):
            raise NotFoundError(f"project not found: {project_id}")
        proof = await self.repo.prove_cell_coordinate(
            project_id, query.condition_id, query.parameter_code
        )
        if proof is None:
            raise NotFoundError("cell history coordinate not found")

        rows = await self.repo.load_cell_history_rows(
            project_id,
            query.condition_id,
            query.parameter_code,
            snapshot_max_event_id=snapshot_max_event_id,
            limit=query.limit + 1,
        )
        page = rows[: query.limit]
        context = await self.repo.load_cell_history_context(
            project_id, query.condition_id, query.parameter_code
        )
        next_cursor = None
        if len(rows) > query.limit and page:
            next_cursor = encode_history_cell_history_cursor(
                HistoryCellHistoryCursor(
                    version=1,
                    project_id=project_id,
                    condition_id=query.condition_id,
                    parameter_code=query.parameter_code,
                    last_event_id=page[-1].event_id,
                )
            )
        return HistoryCellHistoryOut(
            items=[
                HistoryCellHistoryItemOut(
                    event_id=row.event_id,
                    old_code=row.old_value,
                    new_code=row.new_value,
                    actor=row.actor,
                    origin=_origin(row.origin),
                    created_at=row.created_at,
                    layer_key=proof.layer_key or row.layer_key,
                    jump_status="deleted" if proof.deleted else "available",
                )
                for row in page
                if row.created_at is not None
            ],
            baseline_entry=(
                HistoryStateEntryOut(
                    code=context.baseline_entry.code, label=context.baseline_entry.label
                )
                if context.baseline_entry is not None
                else None
            ),
            initial_entry=(
                HistoryStateEntryOut(
                    code=context.initial_entry.code, label=context.initial_entry.label
                )
                if context.initial_entry is not None
                else None
            ),
            initial_state_unavailable=context.initial_state_unavailable,
            next_cursor=next_cursor,
        )


def _member_filters(query: HistoryTimelineQueryIn) -> HistoryMemberFilterScope:
    return HistoryMemberFilterScope(
        layer_keys=(query.layer_key,) if query.layer_key is not None else (),
        event_types=tuple(sorted({item.value for item in query.event_type})),
        actors=(query.actor,) if query.actor is not None else (),
        origins=(query.origin,) if query.origin is not None else (),
        source_project_ids=(query.source_project_id,) if query.source_project_id else (),
        created_from=query.created_from,
        created_to=query.created_to,
    )


def _timeline_item(
    project_id: int,
    filters: HistoryMemberFilterScope,
    group: HistoryTimelineGroupRow,
) -> HistoryTimelineItemOut:
    event_types = set(group.event_types)
    if group.batch_id is None:
        detail_status = "not_applicable"
    elif event_types & _DETAIL_EVENT_TYPES:
        detail_status = "available"
    elif event_types & _CAPTURE_EVENT_TYPES:
        detail_status = "legacy_unavailable"
    else:
        detail_status = "not_applicable"
    detail_scope = (
        encode_history_detail_scope(
            HistoryDetailScope(
                project_id=project_id,
                batch_id=group.batch_id,
                member_filters=filters,
            )
        )
        if group.batch_id is not None and detail_status != "not_applicable"
        else None
    )
    assert group.started_at is not None
    assert group.occurred_at is not None
    return HistoryTimelineItemOut(
        kind=group.group_kind,
        cursor_id=group.max_event_id,
        event_types=list(group.event_types),
        actors=list(group.actors),
        origins=[value for value in group.origins if value in _ORIGINS],
        started_at=group.started_at,
        occurred_at=group.occurred_at,
        layer_keys=list(group.layer_keys),
        source_project_id=group.representative.source_project_id,
        batch_id=group.batch_id,
        matched_event_count=group.matched_event_count,
        total_event_count=group.total_event_count,
        summary="Grouped history changes" if group.group_kind == "batch" else "History change",
        detail_status=detail_status,
        detail_scope=detail_scope,
        metadata_status="legacy_partial" if group.representative.layer_key is None else "complete",
    )


def _origin(value: str | None) -> str:
    return value if value in _ORIGINS else "system"

