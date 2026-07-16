"""Read-only persistence for Phase 4 history queries.

The repository keeps SQL explicit and append-only: project existence, snapshot
freezing, batch-group timeline summaries, batch/member reads, and cell-history
coordinate proof. It intentionally does not expose write paths.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, cast as typing_cast

from sqlalchemy import String, cast as sa_cast, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
    max_event_id: int
    matched_event_count: int
    total_event_count: int
    representative: HistoryEventRow


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

        rows: list[HistoryTimelineGroupRow] = []
        for row in summary_rows:
            max_event_id = int(row["max_event_id"])
            representative = representative_map[max_event_id]
            batch_id = row["batch_id"]
            if batch_id is None:
                total_count = 1
                group_kind: HistoryGroupKind = "event"
                group_key = str(max_event_id)
            else:
                total_count = total_counts_by_batch.get(batch_id, int(row["matched_event_count"]))
                group_kind = "batch"
                group_key = batch_id
            rows.append(
                HistoryTimelineGroupRow(
                    group_key=group_key,
                    batch_id=batch_id,
                    group_kind=group_kind,
                    max_event_id=max_event_id,
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
        return await self._count_batch_member(batch_id, project_id, snapshot_max_event_id=snapshot_max_event_id)

    async def load_batch_members(
        self,
        project_id: int,
        batch_id: str,
        *,
        member_filters: HistoryMemberFilterScope | None = None,
        snapshot_max_event_id: int | None = None,
        limit: int = 200,
    ) -> tuple[HistoryEventRow, ...]:
        stmt = self._event_row_stmt(
            project_id,
            snapshot_max_event_id=snapshot_max_event_id,
            with_payload=True,
        )
        stmt = stmt.where(ChangeEvent.batch_id == batch_id)
        stmt = self._apply_member_filters(stmt, member_filters)
        stmt = stmt.order_by(ChangeEvent.id.desc()).limit(limit)
        return await self._load_event_rows(stmt)

    async def coverage_counts(
        self,
        project_id: int,
        *,
        snapshot_max_event_id: int | None = None,
    ) -> HistoryCoverageCounts:
        unresolved_layers = await self.session.execute(
            select(func.count(SheetLayer.id)).where(
                SheetLayer.project_id == project_id,
                SheetLayer.backbone_snapshot.is_(None),
            )
        )
        # The current phase does not persist a legacy schema-version flag for history rows;
        # repository coverage therefore exposes the structural layer count plus a zero legacy
        # detail count. Future schema versions can tighten this without changing callers.
        return HistoryCoverageCounts(
            legacy_unresolved_layer_count=int(unresolved_layers.scalar_one()),
            legacy_detail_unavailable_count=0,
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
        latest_event = await self._latest_cell_event(project_id, condition_id, parameter_code)
        if removed_event is None and latest_event is None:
            return None
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

    async def load_cell_history_anchor_rows(
        self,
        project_id: int,
        condition_id: int,
        parameter_code: str,
    ) -> tuple[HistoryEventRow, ...]:
        proof = await self.prove_cell_coordinate(project_id, condition_id, parameter_code)
        if proof is None:
            return ()
        rows = list(
            await self.load_cell_history_rows(project_id, condition_id, parameter_code)
        )
        baseline_row = await self._latest_condition_add_event(project_id, condition_id)
        if baseline_row is not None:
            rows.append(
                _anchor_row_from_event(
                    baseline_row,
                    history_role=HistoryEntryRole.BASELINE,
                    parameter_code=parameter_code,
                    deleted=False,
                )
            )
        initial_row = await self._latest_condition_remove_event(
            project_id, condition_id, parameter_code
        )
        if initial_row is not None:
            rows.append(
                _anchor_row_from_event(
                    initial_row,
                    history_role=HistoryEntryRole.INITIAL,
                    parameter_code=parameter_code,
                    deleted=True,
                )
            )
        return tuple(rows)

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
        group_key = case(
            (ChangeEvent.batch_id.is_not(None), ChangeEvent.batch_id),
            else_=sa_cast(ChangeEvent.id, String),
        )
        stmt = (
            select(
                group_key.label("group_key"),
                ChangeEvent.batch_id.label("batch_id"),
                func.max(ChangeEvent.id).label("max_event_id"),
                func.count().label("matched_event_count"),
            )
            .where(ChangeEvent.project_id == project_id)
        )
        if snapshot_max_event_id is not None:
            stmt = stmt.where(ChangeEvent.id <= snapshot_max_event_id)
        stmt = self._apply_member_filters(stmt, member_filters)
        stmt = stmt.group_by(group_key, ChangeEvent.batch_id)
        if before_group_max_id is not None:
            stmt = stmt.having(func.max(ChangeEvent.id) < before_group_max_id)
        return stmt.order_by(func.max(ChangeEvent.id).desc(), group_key.asc()).limit(limit)

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
        return tuple(_event_row_from_mapping(row) for row in rows)

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
        return row

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
                ChangeEvent.condition_id == condition_id,
                ChangeEvent.event_type == "condition_remove",
            )
            .order_by(ChangeEvent.id.desc())
            .limit(1)
        )
        rows = await self._load_event_rows(stmt)
        if not rows:
            stmt = (
                self._event_row_stmt(
                    project_id,
                    snapshot_max_event_id=None,
                    with_payload=True,
                )
                .where(ChangeEvent.event_type == "condition_remove")
                .order_by(ChangeEvent.id.desc())
                .limit(200)
            )
            rows = tuple(
                row
                for row in await self._load_event_rows(stmt)
                if row.condition_id == condition_id
                and (
                    row.parameter_code is None
                    or row.parameter_code == parameter_code
                    or (
                        isinstance(row.detail, Mapping)
                        and parameter_code
                        in typing_cast(Mapping[str, Any], row.detail).get("cells", {})
                    )
                )
            )
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
                ChangeEvent.condition_id == condition_id,
                ChangeEvent.event_type == "condition_add",
            )
            .order_by(ChangeEvent.id.desc())
            .limit(1)
        )
        rows = await self._load_event_rows(stmt)
        if rows:
            return rows[0]

        stmt = (
            self._event_row_stmt(
                project_id,
                snapshot_max_event_id=None,
                with_payload=True,
            )
            .where(ChangeEvent.event_type == "condition_add")
            .order_by(ChangeEvent.id.desc())
            .limit(200)
        )
        rows = tuple(row for row in await self._load_event_rows(stmt) if row.condition_id == condition_id)
        return rows[0] if rows else None

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
        created_at=mapping["created_at"],
        batch_id=mapping["batch_id"],
        origin=None if origin is None else (origin.value if hasattr(origin, "value") else str(origin)),
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
) -> tuple[dict[str, Any], dict[str, Any], int, bool]:
    event_type_text = event_type.value if hasattr(event_type, "value") else str(event_type)
    payload_mapping = payload if isinstance(payload, Mapping) else {}
    if event_type_text in {"backbone_copy", "backbone_layer_replace"}:
        schema_version = 2
        if "payload_schema_version" in payload_mapping:
            schema_version_value = payload_mapping["payload_schema_version"]
            if isinstance(schema_version_value, bool) or not isinstance(schema_version_value, int):
                raise TypeError("payload_schema_version must be an int")
            schema_version = schema_version_value
        detail = payload_mapping.get("detail", {})
        capture = payload_mapping.get("capture", {})
        return (
            dict(detail) if isinstance(detail, Mapping) else {},
            dict(capture) if isinstance(capture, Mapping) else {},
            schema_version,
            False,
        )
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


def _anchor_row_from_event(
    event: HistoryEventRow,
    *,
    history_role: HistoryEntryRole,
    parameter_code: str,
    deleted: bool,
) -> HistoryEventRow:
    value = None
    if isinstance(event.detail, Mapping):
        cells = event.detail.get("cells")
        if isinstance(cells, Mapping):
            cell_value = cells.get(parameter_code)
            if cell_value is not None:
                value = str(cell_value)
    return HistoryEventRow(
        event_id=event.event_id,
        event_type=event.event_type,
        actor=event.actor,
        created_at=event.created_at,
        batch_id=event.batch_id,
        origin=event.origin,
        layer_key=event.layer_key,
        condition_id=event.condition_id,
        condition_index=None,
        source_condition_id=event.source_condition_id,
        source_condition_index=None,
        parameter_code=parameter_code,
        parameter_sort_order=None,
        old_value=None if not deleted else value,
        new_value=value if not deleted else None,
        source_project_id=event.source_project_id,
        source_layer_key=event.source_layer_key,
        schema_version=1,
        history_role=history_role,
        deleted=deleted,
        detail=event.detail,
        capture=event.capture,
    )
