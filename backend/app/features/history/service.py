"""Read-only orchestration for public history endpoints."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Literal, cast

from app.core.errors import ConflictError, NotFoundError
from app.domain.errors import RuleViolationError
from app.features.history.cursor import (
    HistoryCaptureKey,
    HistoryCellHistoryCursor,
    HistoryDetailCursor,
    HistoryDetailScope,
    HistoryMemberFilterScope,
    HistoryTimelineCursor,
    HistoryTimelineScope,
    decode_history_cell_history_cursor,
    decode_history_detail_cursor,
    decode_history_detail_scope,
    decode_history_timeline_cursor,
    encode_history_cell_history_cursor,
    encode_history_detail_cursor,
    encode_history_detail_scope,
    encode_history_timeline_cursor,
    ensure_history_scope_matches,
)
from app.features.history.projection import (
    BackboneCaptureItem,
    HistoryAvailability,
    HistoryCellDetailItem,
    HistoryEventRow,
    HistoryJumpState,
    project_backbone_capture,
    project_cell_detail,
    project_cell_history,
    project_timeline_summary,
)
from app.features.history.repository import (
    CAPTURE_EVENT_ROW_LIMIT,
    HistoryBatchDescriptor,
    HistoryCellCoordinateKey,
    HistoryRepository,
    HistoryTimelineGroupRow,
)
from app.features.history.schema import (
    HistoryCellHistoryItemOut,
    HistoryCellHistoryOut,
    HistoryCellHistoryQueryIn,
    HistoryCoverageOut,
    HistoryDetailCaptureTupleOut,
    HistoryDetailItemOut,
    HistoryDetailOut,
    HistoryDetailQueryIn,
    HistoryDetailStatus,
    HistoryDomainCoordinateOut,
    HistoryJumpTargetOut,
    HistoryMetadataStatus,
    HistoryOrigin,
    HistoryStateEntryOut,
    HistoryTimelineItemOut,
    HistoryTimelineOut,
    HistoryTimelineQueryIn,
)
from app.models.project import ChangeEventType

_DETAIL_EVENT_TYPES = {ChangeEventType.CELL_UPDATE.value}
_CAPTURE_EVENT_TYPES = {
    ChangeEventType.BACKBONE_COPY.value,
    ChangeEventType.BACKBONE_LAYER_REPLACE.value,
}
_ALLOWED_ORIGINS = {"manual", "paste", "backbone", "system"}
_SUMMARY_BY_EVENT_TYPE = {
    ChangeEventType.PROJECT_CREATE.value: "Project created",
    ChangeEventType.PROJECT_PROFILE_UPDATE.value: "Project profile updated",
    ChangeEventType.BACKBONE_COPY.value: "Backbone copied",
    ChangeEventType.BACKBONE_LAYER_REPLACE.value: "Backbone layer replaced",
    ChangeEventType.CELL_UPDATE.value: "Cells updated",
    ChangeEventType.CONDITION_ADD.value: "Condition added",
    ChangeEventType.CONDITION_REMOVE.value: "Condition removed",
    ChangeEventType.POR_CHANGE.value: "POR changed",
}
DetailDomain = Literal["cell", "capture", "not_applicable"]


class HistoryService:
    """Coordinate bounded history reads without mutating the session."""

    def __init__(self, repo: HistoryRepository) -> None:
        self.repo = repo

    async def list_events(
        self, project_id: int, query: HistoryTimelineQueryIn
    ) -> HistoryTimelineOut:
        member_filters = _member_filters(query)
        scope = HistoryTimelineScope(project_id=project_id, member_filters=member_filters)
        if query.cursor is None:
            cursor_snapshot_max_event_id = None
            before_group_max_id = None
            resolve_snapshot = True
        else:
            cursor = decode_history_timeline_cursor(query.cursor, expected_scope=scope)
            cursor_snapshot_max_event_id = cursor.snapshot_max_event_id
            before_group_max_id = cursor.before_group_max_id
            resolve_snapshot = False

        context = await self.repo.load_timeline_context(
            project_id,
            member_filters=member_filters,
            snapshot_max_event_id=cursor_snapshot_max_event_id,
            resolve_snapshot=resolve_snapshot,
        )
        if not context.project_exists:
            raise NotFoundError(f"project not found: {project_id}")
        snapshot_max_event_id = context.snapshot_max_event_id

        groups = await self.repo.list_timeline_groups(
            project_id,
            member_filters=member_filters,
            snapshot_max_event_id=snapshot_max_event_id,
            before_group_max_id=before_group_max_id,
            limit=query.limit + 1,
        )
        page = groups[: query.limit]
        coverage = context.coverage
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
        # Token/path and token/cursor binding are checked before any repository read.
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

        descriptor = await self.repo.describe_batch(
            project_id,
            batch_id,
            member_filters=scope.member_filters,
        )
        if not descriptor.project_exists:
            raise NotFoundError(f"project not found: {project_id}")
        if not descriptor.batch_exists:
            raise NotFoundError(f"event batch not found: {batch_id}")

        # The aggregate descriptor classifies the complete filtered batch without
        # loading payloads, so pagination can never hide a mixed detail domain.
        domain = _detail_domain(descriptor)
        _ensure_detail_cursor_order(cursor, domain)
        if domain == "cell":
            rows = await self.repo.load_cell_batch_page(
                project_id,
                batch_id,
                member_filters=scope.member_filters,
                before_event_id=cursor.last_event_id if cursor is not None else None,
                limit=query.limit + 1,
            )
            return await self._cell_batch_detail(scope, rows, query.limit)
        if domain == "capture":
            rows = await self.repo.load_capture_batch_rows(
                project_id,
                batch_id,
                member_filters=scope.member_filters,
                limit=CAPTURE_EVENT_ROW_LIMIT,
            )
            return await self._capture_batch_detail(scope, rows, cursor, query.limit)
        return HistoryDetailOut(
            order_kind="event_desc",
            detail_status="not_applicable",
            items=[],
            reason="This event batch has no expandable history detail",
        )

    async def _cell_batch_detail(
        self,
        scope: HistoryDetailScope,
        rows: tuple[HistoryEventRow, ...],
        limit: int,
    ) -> HistoryDetailOut:
        page = await self._apply_coordinate_proofs(scope.project_id, rows[:limit])
        projection = project_cell_detail(page)
        row_by_id = {row.event_id: row for row in page}
        next_cursor = None
        if len(rows) > limit and page:
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
            detail_status=cast(HistoryDetailStatus, projection.availability.value),
            items=[
                _cell_detail_item(item, row_by_id[item.event_id])
                for item in projection.items
            ],
            reason=_availability_reason(projection.availability),
            next_cursor=next_cursor,
        )

    async def _capture_batch_detail(
        self,
        scope: HistoryDetailScope,
        rows: tuple[HistoryEventRow, ...],
        cursor: HistoryDetailCursor | None,
        limit: int,
    ) -> HistoryDetailOut:
        capture_rows = tuple(row for row in rows if row.event_type in _CAPTURE_EVENT_TYPES)
        preliminary = project_backbone_capture(capture_rows)
        projection = preliminary
        if preliminary.availability is HistoryAvailability.AVAILABLE:
            condition_states = await self._capture_condition_states(
                scope.project_id, preliminary.items
            )
            projection = project_backbone_capture(
                capture_rows, target_condition_states=condition_states
            )

        last_key = cursor.last_capture_key if cursor is not None else None
        candidates = tuple(
            item
            for item in projection.items
            if last_key is None or _capture_sort_key(item) > _cursor_capture_sort_key(last_key)
        )
        page = candidates[:limit]
        row_by_id = {row.event_id: row for row in capture_rows}
        next_cursor = None
        if len(candidates) > limit and page:
            next_cursor = encode_history_detail_cursor(
                HistoryDetailCursor(
                    version=1,
                    scope=scope,
                    order_kind="capture_asc",
                    last_capture_key=_capture_cursor_key(page[-1]),
                )
            )
        return HistoryDetailOut(
            order_kind="capture_asc",
            detail_status=cast(HistoryDetailStatus, projection.availability.value),
            items=[_capture_detail_item(item, row_by_id[item.event_id]) for item in page],
            reason=_availability_reason(projection.availability),
            next_cursor=next_cursor,
        )

    async def _apply_coordinate_proofs(
        self, project_id: int, rows: tuple[HistoryEventRow, ...]
    ) -> tuple[HistoryEventRow, ...]:
        coordinates: tuple[HistoryCellCoordinateKey, ...] = tuple(
            sorted(
                {
                    (row.condition_id, row.parameter_code)
                    for row in rows
                    if row.condition_id is not None and row.parameter_code is not None
                }
            )
        )
        proofs = await self.repo.prove_cell_coordinates(project_id, coordinates)
        proven: list[HistoryEventRow] = []
        for row in rows:
            if row.condition_id is None or row.parameter_code is None:
                proven.append(replace(row, deleted=True))
                continue
            key = (row.condition_id, row.parameter_code)
            proof = proofs.get(key)
            deleted = proof is None or proof.deleted
            layer_key = proof.layer_key if proof is not None else None
            proven.append(
                replace(
                    row,
                    deleted=deleted,
                    layer_key=layer_key if layer_key is not None else row.layer_key,
                )
            )
        return tuple(proven)

    async def _capture_condition_states(
        self, project_id: int, items: tuple[BackboneCaptureItem, ...]
    ) -> dict[int, HistoryJumpState]:
        # Jump state is condition-scoped. Prove one deterministic representative
        # coordinate per target rather than every flattened capture cell.
        representatives: dict[int, HistoryCellCoordinateKey] = {}
        for item in items:
            representatives.setdefault(
                item.target_condition_id,
                (item.target_condition_id, item.parameter_code),
            )
        proofs = await self.repo.prove_cell_coordinates(
            project_id, tuple(representatives.values())
        )
        return {
            condition_id: (
                HistoryJumpState.PRESENT
                if (proof := proofs.get(key)) is not None and not proof.deleted
                else HistoryJumpState.DELETED
            )
            for condition_id, key in representatives.items()
        }

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
        proven_page = tuple(
            replace(
                row,
                deleted=proof.deleted,
                layer_key=proof.layer_key if proof.layer_key is not None else row.layer_key,
            )
            for row in page
        )
        projection = project_cell_history(proven_page)
        row_by_id = {row.event_id: row for row in proven_page}
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
                    event_id=item.event_id,
                    old_code=item.old_value,
                    new_code=item.new_value,
                    actor=item.actor,
                    origin=_origin(row_by_id[item.event_id].origin),
                    created_at=_created_at(row_by_id[item.event_id]),
                    layer_key=item.layer_key,
                    jump_status="deleted" if item.deleted else "available",
                    metadata_status=_metadata_status(item.layer_key),
                )
                for item in projection.entries
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
    projection = project_timeline_summary((group.representative,))
    projected = projection.items[0]
    detail_status = cast(
        HistoryDetailStatus,
        "not_applicable"
        if group.batch_id is None
        else projected.detail_applicability.value,
    )
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
    if group.started_at is None or group.occurred_at is None:
        raise ConflictError("history timeline timestamps are invalid", code="invalid_event_batch")
    return HistoryTimelineItemOut(
        kind=group.group_kind,
        cursor_id=group.max_event_id,
        event_types=[ChangeEventType(value) for value in group.event_types],
        actors=list(group.actors),
        origins=[_origin(value) for value in group.origins],
        started_at=group.started_at,
        occurred_at=group.occurred_at,
        layer_keys=list(group.layer_keys),
        source_project_id=group.representative.source_project_id,
        batch_id=group.batch_id,
        matched_event_count=group.matched_event_count,
        total_event_count=group.total_event_count,
        summary=_timeline_summary(group),
        detail_status=detail_status,
        detail_scope=detail_scope,
        # Timeline rows intentionally do not claim a live jump state. Truthful
        # availability requires coordinate proof, which belongs to detail reads.
        jump_target=None,
        metadata_status=(
            "legacy_partial"
            if projected.legacy_coverage is HistoryAvailability.LEGACY_UNAVAILABLE
            else "complete"
        ),
    )


def _detail_domain(descriptor: HistoryBatchDescriptor) -> DetailDomain:
    has_cell = descriptor.cell_event_count > 0
    has_capture = descriptor.capture_event_count > 0
    if has_cell and has_capture:
        raise ConflictError("event batch mixes detail domains", code="invalid_event_batch")
    if has_cell:
        return "cell"
    if has_capture:
        return "capture"
    return "not_applicable"


def _ensure_detail_cursor_order(
    cursor: HistoryDetailCursor | None, domain: DetailDomain
) -> None:
    if cursor is None:
        return
    expected = "capture_asc" if domain == "capture" else "event_desc"
    if cursor.order_kind != expected:
        raise RuleViolationError(
            "history detail cursor order does not match the batch",
            code="invalid_cursor",
        )


def _cell_detail_item(item: HistoryCellDetailItem, row: HistoryEventRow) -> HistoryDetailItemOut:
    layer_key = item.layer_key
    condition_id = item.condition_id
    parameter_code = item.parameter_code
    deleted = item.jump_state is HistoryJumpState.DELETED
    coordinate = (
        HistoryDomainCoordinateOut(
            layer_key=layer_key,
            condition_id=condition_id,
            parameter_code=parameter_code,
        )
        if layer_key is not None
        else None
    )
    return HistoryDetailItemOut(
        event_id=item.event_id,
        old_code=item.old_value,
        new_code=item.new_value,
        actor=item.actor,
        origin=_origin(row.origin),
        created_at=_created_at(row),
        layer_key=layer_key,
        jump_target=HistoryJumpTargetOut(
            layer_key=layer_key,
            condition_id=condition_id,
            parameter_code=parameter_code,
            jump_status="deleted" if deleted else "available",
        ),
        domain_coordinate=coordinate,
        metadata_status=_metadata_status(layer_key),
    )


def _capture_detail_item(
    item: BackboneCaptureItem, row: HistoryEventRow
) -> HistoryDetailItemOut:
    deleted = item.jump_state is HistoryJumpState.DELETED
    return HistoryDetailItemOut(
        event_id=item.event_id,
        copied_value=item.copied_value,
        actor=row.actor,
        origin=_origin(row.origin),
        created_at=_created_at(row),
        layer_key=item.layer_key,
        jump_target=HistoryJumpTargetOut(
            layer_key=item.layer_key,
            condition_id=item.target_condition_id,
            parameter_code=item.parameter_code,
            jump_status="deleted" if deleted else "available",
        ),
        domain_coordinate=HistoryDomainCoordinateOut(
            layer_key=item.layer_key,
            condition_id=item.target_condition_id,
            parameter_code=item.parameter_code,
        ),
        capture_tuple=HistoryDetailCaptureTupleOut(
            target_layer_sort=item.target_layer_sort,
            target_layer_key=item.target_layer_key,
            source_condition_index=item.source_condition_index,
            source_condition_id=item.source_condition_id,
            parameter_sort=item.parameter_sort,
            parameter_code=item.parameter_code,
            event_id=item.event_id,
        ),
        metadata_status="complete",
    )


def _capture_sort_key(item: BackboneCaptureItem) -> tuple[int, str, int, int, int, str, int]:
    return (
        item.target_layer_sort,
        item.target_layer_key,
        item.source_condition_index,
        item.source_condition_id,
        item.parameter_sort,
        item.parameter_code,
        item.event_id,
    )


def _cursor_capture_sort_key(
    key: HistoryCaptureKey,
) -> tuple[int, str, int, int, int, str, int]:
    if key.event_id is None:
        raise RuleViolationError("capture cursor event id is required", code="invalid_cursor")
    return (
        key.target_layer_sort,
        key.target_layer_key,
        key.source_condition_index,
        key.source_condition_id,
        key.parameter_sort,
        key.parameter_code,
        key.event_id,
    )


def _capture_cursor_key(item: BackboneCaptureItem) -> HistoryCaptureKey:
    return HistoryCaptureKey(
        target_layer_sort=item.target_layer_sort,
        target_layer_key=item.target_layer_key,
        source_condition_index=item.source_condition_index,
        source_condition_id=item.source_condition_id,
        parameter_sort=item.parameter_sort,
        parameter_code=item.parameter_code,
        event_id=item.event_id,
    )


def _created_at(row: HistoryEventRow) -> datetime:
    if row.created_at is None:
        raise ConflictError("history event timestamp is invalid", code="invalid_event_batch")
    return row.created_at


def _origin(value: str | None) -> HistoryOrigin:
    return cast(HistoryOrigin, value if value in _ALLOWED_ORIGINS else "system")


def _metadata_status(layer_key: str | None) -> HistoryMetadataStatus:
    return "complete" if layer_key is not None else "legacy_partial"


def _availability_reason(availability: HistoryAvailability) -> str | None:
    if availability is HistoryAvailability.LEGACY_UNAVAILABLE:
        return "Legacy event detail is unavailable"
    if availability is HistoryAvailability.NOT_APPLICABLE:
        return "This event batch has no expandable history detail"
    return None


def _timeline_summary(group: HistoryTimelineGroupRow) -> str:
    labels = tuple(
        _SUMMARY_BY_EVENT_TYPE[event_type]
        for event_type in group.event_types
        if event_type in _SUMMARY_BY_EVENT_TYPE
    )
    if len(labels) == 1:
        return labels[0]
    if group.group_kind == "batch":
        return "Grouped history changes"
    return "History change"
