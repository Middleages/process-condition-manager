"""Read-only persistence for Phase 4 history queries.

The repository keeps SQL explicit and append-only: project existence, snapshot
freezing, batch-group timeline summaries, batch/member reads, and cell-history
coordinate proof. It intentionally does not expose write paths.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from typing import cast as typing_cast

from sqlalchemy import String, case, func, literal, select
from sqlalchemy import cast as sa_cast
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.domain.backbone.snapshot import parse_backbone_snapshot
from app.features.history.cursor import HistoryMemberFilterScope
from app.features.history.projection import HistoryEntryRole, HistoryEventRow
from app.models.project import ChangeEvent, LayerCondition, Project, SheetLayer

HistoryGroupKind = Literal["batch", "event"]
HistoryCoordinateState = Literal["current", "deleted"]


@dataclass(frozen=True, slots=True)
class HistoryTimelineGroupRow:
    group_key: str
    batch_id: str | None
    group_kind: HistoryGroupKind
    min_event_id: int
    max_event_id: int
    started_at: datetime | None
    occurred_at: datetime | None
    event_types: tuple[str, ...]
    actors: tuple[str, ...]
    origins: tuple[str, ...]
    layer_keys: tuple[str, ...]
    matched_event_count: int
    total_event_count: int
    representative: HistoryEventRow


@dataclass(frozen=True, slots=True)
class HistoryCellStateRow:
    code: str | None
    label: str | None = None


@dataclass(frozen=True, slots=True)
class HistoryCellHistoryContext:
    baseline_entry: HistoryCellStateRow | None
    initial_entry: HistoryCellStateRow | None
    initial_state_unavailable: bool
    remove_event: HistoryEventRow | None


@dataclass(frozen=True, slots=True)
class HistoryCoverageCounts:
    legacy_unresolved_layer_count: int
    legacy_detail_unavailable_count: int


@dataclass(frozen=True, slots=True)
class HistoryCellCoordinateProof:
    state: HistoryCoordinateState
    project_id: int
    condition_id: int
    parameter_code: str
    layer_key: str | None
    current_event_id: int | None
    remove_event_id: int | None
    latest_event_id: int | None

    @property
    def deleted(self) -> bool:
        return self.state == "deleted"


_SUMMARY_EVENT_COLUMNS = (
    ChangeEvent.id,
    ChangeEvent.event_type,
    ChangeEvent.actor,
    ChangeEvent.created_at,
    ChangeEvent.batch_id,
    ChangeEvent.origin,
    ChangeEvent.layer_key,
    ChangeEvent.condition_id,
    ChangeEvent.parameter_code,
    ChangeEvent.old_value,
    ChangeEvent.new_value,
    ChangeEvent.source_project_id,
    ChangeEvent.source_layer_key,
)

_DETAIL_EVENT_COLUMNS = (
    *_SUMMARY_EVENT_COLUMNS,
    ChangeEvent.payload,
)


class HistoryRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def project_exists(self, project_id: int) -> bool:
        result = await self.session.execute(
            select(Project.id).where(Project.id == project_id).limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def snapshot_max_event_id(
        self,
        project_id: int,
        *,
        member_filters: HistoryMemberFilterScope | None = None,
    ) -> int | None:
        stmt = select(func.max(ChangeEvent.id)).where(ChangeEvent.project_id == project_id)
        stmt = self._apply_member_filters(stmt, member_filters)
        return self._scalar_int(await self.session.execute(stmt))

    async def list_timeline_groups(
        self,
        project_id: int,
        *,
        member_filters: HistoryMemberFilterScope | None = None,
        snapshot_max_event_id: int | None = None,
        before_group_max_id: int | None = None,
        limit: int = 50,
    ) -> tuple[HistoryTimelineGroupRow, ...]:
        summary_stmt = self._timeline_summary_stmt(
            project_id,
            member_filters=member_filters,
            snapshot_max_event_id=snapshot_max_event_id,
            before_group_max_id=before_group_max_id,
            limit=limit,
        )
        summary_rows = list((await self.session.execute(summary_stmt)).mappings().all())
        if not summary_rows:
            return ()

        representative_ids = [int(row["max_event_id"]) for row in summary_rows]
        representatives = await self._load_event_rows_by_ids(project_id, representative_ids)
        representative_map = {row.event_id: row for row in representatives}

        batch_ids = tuple(
            row["batch_id"] for row in summary_rows if row["batch_id"] is not None
        )
        total_counts_by_batch = await self._count_batch_members(
            project_id,
            batch_ids,
            snapshot_max_event_id=snapshot_max_event_id,
        )
        matched_rows_by_batch = await self._load_matched_batch_rows(
            project_id,
            batch_ids,
            member_filters=member_filters,
            snapshot_max_event_id=snapshot_max_event_id,
        )

        rows: list[HistoryTimelineGroupRow] = []
        for row in summary_rows:
            max_event_id = int(row["max_event_id"])
            min_event_id = int(row["min_event_id"])
            representative = representative_map[max_event_id]
            batch_id = row["batch_id"]
            started_at = row["started_at"]
            occurred_at = row["occurred_at"]
            if batch_id is None:
                matched_rows = (representative,)
                total_count = 1
                group_kind: HistoryGroupKind = "event"
                group_key = f"event:{max_event_id}"
            else:
                total_count = total_counts_by_batch.get(batch_id, int(row["matched_event_count"]))
                group_kind = "batch"
                group_key = f"batch:{batch_id}"
                matched_rows = matched_rows_by_batch.get(batch_id, (representative,))
            ordered_rows = tuple(sorted(matched_rows, key=lambda item: item.event_id, reverse=True))
            rows.append(
                HistoryTimelineGroupRow(
                    group_key=group_key,
                    batch_id=batch_id,
                    group_kind=group_kind,
                    min_event_id=min_event_id,
                    max_event_id=max_event_id,
                    started_at=_utc_datetime(started_at),
                    occurred_at=_utc_datetime(occurred_at),
                    event_types=_ordered_unique(row.event_type for row in ordered_rows),
                    actors=_ordered_unique(row.actor for row in ordered_rows),
                    origins=_ordered_unique(
                        row.origin for row in ordered_rows if row.origin is not None
                    ),
                    layer_keys=_ordered_unique(
                        row.layer_key for row in ordered_rows if row.layer_key is not None
                    ),
                    matched_event_count=int(row["matched_event_count"]),
                    total_event_count=total_count,
                    representative=representative,
                )
            )
        return tuple(rows)

    async def count_batch_members(
        self,
        project_id: int,
        batch_id: str,
        *,
        snapshot_max_event_id: int | None = None,
    ) -> int:
        return await self._count_batch_member(
            batch_id,
            project_id,
            snapshot_max_event_id=snapshot_max_event_id,
        )

    async def load_batch_members(
        self,
        project_id: int,
        batch_id: str,
        *,
        member_filters: HistoryMemberFilterScope | None = None,
        snapshot_max_event_id: int | None = None,
        before_event_id: int | None = None,
        limit: int = 200,
    ) -> tuple[HistoryEventRow, ...]:
        stmt = self._event_row_stmt(
            project_id,
            snapshot_max_event_id=snapshot_max_event_id,
            with_payload=True,
        )
        stmt = stmt.where(ChangeEvent.batch_id == batch_id)
        if before_event_id is not None:
            stmt = stmt.where(ChangeEvent.id < before_event_id)
        stmt = self._apply_member_filters(stmt, member_filters)
        stmt = stmt.order_by(ChangeEvent.id.desc()).limit(limit)
        return await self._load_event_rows(stmt)

    async def coverage_counts(
        self,
        project_id: int,
        *,
        snapshot_max_event_id: int | None = None,
    ) -> HistoryCoverageCounts:
        layer_bearing_event_types = (
            "cell_update",
            "condition_add",
            "condition_remove",
            "por_change",
            "backbone_copy",
            "backbone_layer_replace",
        )
        legacy_unresolved_layer_count_expr = func.coalesce(
            func.sum(
            case(
                (
                    ChangeEvent.event_type.in_(layer_bearing_event_types)
                    & ChangeEvent.layer_key.is_(None),
                    1,
                ),
                else_=0,
            )
            ),
            0,
        )
        legacy_detail_count_expr = func.coalesce(
            func.sum(
            case(
                (
                    ChangeEvent.event_type.in_(("backbone_copy", "backbone_layer_replace"))
                    & (
                        func.coalesce(
                            ChangeEvent.payload["payload_schema_version"].as_integer(), 1
                        )
                        < 2
                    ),
                    1,
                ),
                else_=0,
            )
            ),
            0,
        )
        stmt = select(
            legacy_unresolved_layer_count_expr.label("legacy_unresolved_layer_count"),
            legacy_detail_count_expr.label("legacy_detail_unavailable_count"),
        ).where(ChangeEvent.project_id == project_id)
        if snapshot_max_event_id is not None:
            stmt = stmt.where(ChangeEvent.id <= snapshot_max_event_id)
        unresolved_layers, legacy_detail_count = (await self.session.execute(stmt)).one()
        return HistoryCoverageCounts(
            legacy_unresolved_layer_count=int(unresolved_layers),
            legacy_detail_unavailable_count=int(legacy_detail_count),
        )

    async def load_cell_history_rows(
        self,
        project_id: int,
        condition_id: int,
        parameter_code: str,
        *,
        snapshot_max_event_id: int | None = None,
        limit: int = 100,
    ) -> tuple[HistoryEventRow, ...]:
        stmt = self._event_row_stmt(
            project_id,
            snapshot_max_event_id=snapshot_max_event_id,
            with_payload=True,
        )
        stmt = stmt.where(
            ChangeEvent.condition_id == condition_id,
            ChangeEvent.parameter_code == parameter_code,
            ChangeEvent.event_type == "cell_update",
        )
        stmt = stmt.order_by(ChangeEvent.id.desc()).limit(limit)
        return await self._load_event_rows(stmt)

    async def load_cell_history_context(
        self,
        project_id: int,
        condition_id: int,
        parameter_code: str,
    ) -> HistoryCellHistoryContext:
        baseline_entry = await self._baseline_cell_state_row(
            project_id, condition_id, parameter_code
        )
        initial_event = await self._latest_condition_add_event(project_id, condition_id)
        remove_event = await self._latest_condition_remove_event(
            project_id, condition_id, parameter_code
        )
        initial_entry = None
        if initial_event is not None:
            initial_entry = _state_row_from_snapshot(initial_event.detail, parameter_code)
        return HistoryCellHistoryContext(
            baseline_entry=baseline_entry,
            initial_entry=initial_entry,
            initial_state_unavailable=initial_entry is None,
            remove_event=remove_event,
        )

    async def prove_cell_coordinate(
        self,
        project_id: int,
        condition_id: int,
        parameter_code: str,
    ) -> HistoryCellCoordinateProof | None:
        current_row = await self._current_coordinate_row(project_id, condition_id, parameter_code)
        if current_row is not None:
            latest_event = await self._latest_cell_event(project_id, condition_id, parameter_code)
            return HistoryCellCoordinateProof(
                state="current",
                project_id=project_id,
                condition_id=condition_id,
                parameter_code=parameter_code,
                layer_key=current_row["layer_key"],
                current_event_id=latest_event.event_id if latest_event is not None else None,
                remove_event_id=None,
                latest_event_id=latest_event.event_id if latest_event is not None else None,
            )

        removed_event = await self._latest_condition_remove_event(
            project_id, condition_id, parameter_code
        )
        if removed_event is None:
            return None
        if not _snapshot_contains_parameter(removed_event.detail, parameter_code):
            return None
        latest_event = await self._latest_cell_event(project_id, condition_id, parameter_code)
        layer_key = (
            removed_event.layer_key
            if removed_event is not None and removed_event.layer_key is not None
            else (latest_event.layer_key if latest_event is not None else None)
        )
        return HistoryCellCoordinateProof(
            state="deleted",
            project_id=project_id,
            condition_id=condition_id,
            parameter_code=parameter_code,
            layer_key=layer_key,
            current_event_id=None,
            remove_event_id=removed_event.event_id if removed_event is not None else None,
            latest_event_id=latest_event.event_id if latest_event is not None else None,
        )

    async def _count_batch_members(
        self,
        project_id: int,
        batch_ids: Sequence[str],
        *,
        snapshot_max_event_id: int | None = None,
    ) -> dict[str, int]:
        if not batch_ids:
            return {}
        stmt = select(ChangeEvent.batch_id, func.count()).where(
            ChangeEvent.project_id == project_id,
            ChangeEvent.batch_id.in_(batch_ids),
        )
        if snapshot_max_event_id is not None:
            stmt = stmt.where(ChangeEvent.id <= snapshot_max_event_id)
        stmt = stmt.group_by(ChangeEvent.batch_id)
        rows = (await self.session.execute(stmt)).all()
        return {str(batch_id): int(total) for batch_id, total in rows if batch_id is not None}

    async def _count_batch_member(
        self,
        batch_id: str,
        project_id: int,
        *,
        snapshot_max_event_id: int | None = None,
    ) -> int:
        counts = await self._count_batch_members(
            project_id,
            (batch_id,),
            snapshot_max_event_id=snapshot_max_event_id,
        )
        return counts.get(batch_id, 0)

    def _timeline_summary_stmt(
        self,
        project_id: int,
        *,
        member_filters: HistoryMemberFilterScope | None,
        snapshot_max_event_id: int | None,
        before_group_max_id: int | None,
        limit: int,
    ):
        group_key_expr = case(
            (ChangeEvent.batch_id.is_not(None), literal("batch:") + ChangeEvent.batch_id),
            else_=literal("event:") + sa_cast(ChangeEvent.id, String),
        )
        group_key = group_key_expr.label("group_key")
        stmt = (
            select(
                group_key,
                ChangeEvent.batch_id.label("batch_id"),
                func.min(ChangeEvent.id).label("min_event_id"),
                func.max(ChangeEvent.id).label("max_event_id"),
                func.min(ChangeEvent.created_at).label("started_at"),
                func.max(ChangeEvent.created_at).label("occurred_at"),
                func.count().label("matched_event_count"),
            )
            .where(ChangeEvent.project_id == project_id)
        )
        if snapshot_max_event_id is not None:
            stmt = stmt.where(ChangeEvent.id <= snapshot_max_event_id)
        stmt = self._apply_member_filters(stmt, member_filters)
        stmt = stmt.group_by(ChangeEvent.batch_id, group_key_expr)
        if before_group_max_id is not None:
            stmt = stmt.having(func.max(ChangeEvent.id) < before_group_max_id)
        return stmt.order_by(func.max(ChangeEvent.id).desc(), group_key_expr.asc()).limit(limit)

    async def _load_matched_batch_rows(
        self,
        project_id: int,
        batch_ids: Sequence[str],
        *,
        member_filters: HistoryMemberFilterScope | None,
        snapshot_max_event_id: int | None,
    ) -> dict[str, tuple[HistoryEventRow, ...]]:
        if not batch_ids:
            return {}
        stmt = self._event_row_stmt(
            project_id,
            snapshot_max_event_id=snapshot_max_event_id,
            with_payload=False,
        ).where(ChangeEvent.batch_id.in_(batch_ids))
        stmt = self._apply_member_filters(stmt, member_filters)
        stmt = stmt.order_by(ChangeEvent.batch_id.asc(), ChangeEvent.id.desc())
        rows = await self._load_event_rows(stmt)
        grouped: dict[str, list[HistoryEventRow]] = {}
        for row in rows:
            if row.batch_id is None:
                continue
            grouped.setdefault(row.batch_id, []).append(row)
        return {batch_id: tuple(items) for batch_id, items in grouped.items()}

    def _event_row_stmt(
        self,
        project_id: int,
        *,
        snapshot_max_event_id: int | None,
        with_payload: bool = False,
    ):
        columns = _DETAIL_EVENT_COLUMNS if with_payload else _SUMMARY_EVENT_COLUMNS
        stmt = select(*columns).where(ChangeEvent.project_id == project_id)
        if snapshot_max_event_id is not None:
            stmt = stmt.where(ChangeEvent.id <= snapshot_max_event_id)
        return stmt

    async def _load_event_rows(self, stmt) -> tuple[HistoryEventRow, ...]:
        rows = (await self.session.execute(stmt)).mappings().all()
        return tuple(_event_row_from_mapping(typing_cast(Mapping[str, Any], row)) for row in rows)

    async def _load_event_rows_by_ids(
        self, project_id: int, event_ids: Sequence[int]
    ) -> tuple[HistoryEventRow, ...]:
        if not event_ids:
            return ()
        stmt = self._event_row_stmt(
            project_id,
            snapshot_max_event_id=None,
            with_payload=False,
        ).where(
            ChangeEvent.id.in_(event_ids)
        )
        stmt = stmt.order_by(ChangeEvent.id.desc())
        return await self._load_event_rows(stmt)

    async def _current_coordinate_row(
        self,
        project_id: int,
        condition_id: int,
        parameter_code: str,
    ) -> Mapping[str, Any] | None:
        stmt = (
            select(
                SheetLayer.layer_key.label("layer_key"),
            )
            .select_from(LayerCondition)
            .join(SheetLayer, SheetLayer.id == LayerCondition.layer_id)
            .where(
                SheetLayer.project_id == project_id,
                LayerCondition.id == condition_id,
            )
            .limit(1)
        )
        row = (await self.session.execute(stmt)).mappings().first()
        return typing_cast(Mapping[str, Any] | None, row)

    async def _baseline_cell_state_row(
        self,
        project_id: int,
        condition_id: int,
        parameter_code: str,
    ) -> HistoryCellStateRow | None:
        stmt = (
            select(
                LayerCondition.label.label("label"),
                LayerCondition.source_condition_id.label("source_condition_id"),
                SheetLayer.backbone_snapshot.label("backbone_snapshot"),
            )
            .select_from(LayerCondition)
            .join(SheetLayer, SheetLayer.id == LayerCondition.layer_id)
            .where(
                SheetLayer.project_id == project_id,
                LayerCondition.id == condition_id,
            )
            .limit(1)
        )
        row = (await self.session.execute(stmt)).mappings().first()
        if row is None:
            return None
        source_condition_id = row["source_condition_id"]
        backbone_snapshot = row["backbone_snapshot"]
        if source_condition_id is None or backbone_snapshot is None:
            return None
        try:
            snapshot = parse_backbone_snapshot(backbone_snapshot)
        except Exception:
            return None
        for condition in snapshot.conditions:
            if condition.source_condition_id != source_condition_id:
                continue
            return _state_row_from_backbone_condition(condition, parameter_code)
        return None

    async def _latest_cell_event(
        self,
        project_id: int,
        condition_id: int,
        parameter_code: str,
    ) -> HistoryEventRow | None:
        stmt = (
            self._event_row_stmt(
                project_id,
                snapshot_max_event_id=None,
                with_payload=True,
            )
            .where(
                ChangeEvent.condition_id == condition_id,
                ChangeEvent.parameter_code == parameter_code,
                ChangeEvent.event_type == "cell_update",
            )
            .order_by(ChangeEvent.id.desc())
            .limit(1)
        )
        rows = await self._load_event_rows(stmt)
        return rows[0] if rows else None

    async def _latest_condition_remove_event(
        self,
        project_id: int,
        condition_id: int,
        parameter_code: str,
    ) -> HistoryEventRow | None:
        stmt = (
            self._event_row_stmt(
                project_id,
                snapshot_max_event_id=None,
                with_payload=True,
            )
            .where(
                ChangeEvent.event_type == "condition_remove",
                (
                    (ChangeEvent.condition_id == condition_id)
                    | (ChangeEvent.payload["condition_id"].as_integer() == condition_id)
                ),
            )
            .order_by(ChangeEvent.id.desc())
            .limit(1)
        )
        rows = await self._load_event_rows(stmt)
        return rows[0] if rows else None

    async def _latest_condition_add_event(
        self,
        project_id: int,
        condition_id: int,
    ) -> HistoryEventRow | None:
        stmt = (
            self._event_row_stmt(
                project_id,
                snapshot_max_event_id=None,
                with_payload=True,
            )
            .where(
                ChangeEvent.event_type == "condition_add",
                (
                    (ChangeEvent.condition_id == condition_id)
                    | (ChangeEvent.payload["condition_id"].as_integer() == condition_id)
                ),
            )
            .order_by(ChangeEvent.id.desc())
            .limit(1)
        )
        rows = await self._load_event_rows(stmt)
        if rows:
            return rows[0]
        return None

    def _apply_member_filters(
        self,
        stmt,
        member_filters: HistoryMemberFilterScope | None,
    ):
        if member_filters is None:
            return stmt
        if member_filters.layer_keys:
            stmt = stmt.where(ChangeEvent.layer_key.in_(member_filters.layer_keys))
        if member_filters.event_types:
            stmt = stmt.where(ChangeEvent.event_type.in_(member_filters.event_types))
        if member_filters.actors:
            stmt = stmt.where(ChangeEvent.actor.in_(member_filters.actors))
        if member_filters.origins:
            stmt = stmt.where(ChangeEvent.origin.in_(member_filters.origins))
        if member_filters.source_project_ids:
            stmt = stmt.where(ChangeEvent.source_project_id.in_(member_filters.source_project_ids))
        if member_filters.created_from is not None:
            stmt = stmt.where(ChangeEvent.created_at >= member_filters.created_from)
        if member_filters.created_to is not None:
            stmt = stmt.where(ChangeEvent.created_at < member_filters.created_to)
        return stmt

    @staticmethod
    def _scalar_int(result) -> int | None:
        value = result.scalar_one_or_none()
        return int(value) if value is not None else None


def _ordered_unique(values: Iterable[str]) -> tuple[str, ...]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return tuple(ordered)


def _utc_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, datetime):
        return value
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _event_row_from_mapping(mapping: Mapping[str, Any]) -> HistoryEventRow:
    event_type = mapping["event_type"]
    actor = mapping["actor"]
    origin = mapping["origin"]
    payload = mapping.get("payload")
    detail, capture, schema_version, deleted = _history_payload_fields(event_type, payload)
    condition_id = mapping["condition_id"]
    layer_key = mapping["layer_key"]
    if isinstance(payload, Mapping):
        payload_condition_id = payload.get("condition_id")
        payload_layer_key = payload.get("layer_key")
        if condition_id is None and isinstance(payload_condition_id, int) and not isinstance(
            payload_condition_id, bool
        ):
            condition_id = payload_condition_id
        if layer_key is None and isinstance(payload_layer_key, str):
            layer_key = payload_layer_key
    return HistoryEventRow(
        event_id=int(mapping["id"]),
        event_type=event_type.value if hasattr(event_type, "value") else str(event_type),
        actor=actor.value if hasattr(actor, "value") else str(actor),
        created_at=_utc_datetime(mapping["created_at"]),
        batch_id=mapping["batch_id"],
        origin=(
            None
            if origin is None
            else (origin.value if hasattr(origin, "value") else str(origin))
        ),
        layer_key=layer_key,
        condition_id=condition_id,
        condition_index=None,
        source_condition_id=None,
        source_condition_index=None,
        parameter_code=mapping["parameter_code"],
        parameter_sort_order=None,
        old_value=mapping["old_value"],
        new_value=mapping["new_value"],
        source_project_id=mapping["source_project_id"],
        source_layer_key=mapping["source_layer_key"],
        schema_version=schema_version,
        history_role=HistoryEntryRole.CURRENT,
        deleted=deleted,
        detail=detail,
        capture=capture,
    )


def _history_payload_fields(
    event_type: Any, payload: Any
) -> tuple[Any, dict[str, Any], int, bool]:
    event_type_text = event_type.value if hasattr(event_type, "value") else str(event_type)
    payload_mapping = payload if isinstance(payload, Mapping) else {}
    if event_type_text in {"backbone_copy", "backbone_layer_replace"}:
        schema_version = 1
        if "payload_schema_version" in payload_mapping:
            schema_version_value = payload_mapping["payload_schema_version"]
            if isinstance(schema_version_value, bool) or not isinstance(schema_version_value, int):
                raise ConflictError("capture batch is invalid", code="invalid_event_batch")
            if schema_version_value not in (1, 2):
                raise ConflictError("capture batch is invalid", code="invalid_event_batch")
            schema_version = schema_version_value
        if schema_version == 2:
            detail = payload_mapping.get("detail")
            capture = payload_mapping.get("capture")
            if not isinstance(detail, list) or not isinstance(capture, Mapping):
                raise ConflictError("capture batch is invalid", code="invalid_event_batch")
            return (
                list(detail),
                dict(capture),
                schema_version,
                False,
            )
        return {}, {}, schema_version, False
    if event_type_text == "condition_remove":
        snapshot = payload_mapping.get("snapshot", {})
        detail = snapshot if isinstance(snapshot, Mapping) else {}
        return dict(detail), {}, 1, True
    if event_type_text == "condition_add":
        snapshot = payload_mapping.get("snapshot", {})
        detail = snapshot if isinstance(snapshot, Mapping) else {}
        return dict(detail), {}, 1, False
    if event_type_text == "project_create":
        return {}, {}, 1, False
    return {}, {}, 2, False


def _state_row_from_snapshot(
    snapshot: Any,
    parameter_code: str,
) -> HistoryCellStateRow | None:
    if not isinstance(snapshot, Mapping):
        return None
    cells = snapshot.get("cells")
    if not isinstance(cells, Mapping):
        return None
    if parameter_code not in cells:
        return None
    code: str | None = None
    label: str | None = None
    label_value = snapshot.get("label")
    if isinstance(label_value, str):
        label = label_value
    cell_value = cells.get(parameter_code)
    if cell_value is not None:
        code = str(cell_value)
    return HistoryCellStateRow(code=code, label=label)


def _state_row_from_backbone_condition(
    condition: Any,
    parameter_code: str,
) -> HistoryCellStateRow | None:
    label = getattr(condition, "label", None)
    code: str | None = None
    cells = getattr(condition, "cells", ())
    matched = False
    for cell in cells:
        if getattr(cell, "parameter_code", None) == parameter_code:
            matched = True
            value = getattr(cell, "value", None)
            if value is not None:
                code = str(value)
            break
    if not matched:
        return None
    return HistoryCellStateRow(
        code=code,
        label=label if isinstance(label, str) else None,
    )


def _snapshot_contains_parameter(snapshot: Any, parameter_code: str) -> bool:
    if not isinstance(snapshot, Mapping):
        return False
    cells = snapshot.get("cells")
    if not isinstance(cells, Mapping):
        return False
    return parameter_code in cells
