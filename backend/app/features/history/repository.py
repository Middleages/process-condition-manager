"""Read-only persistence for Phase 4 history queries.

The repository keeps SQL explicit and append-only: project existence, snapshot
freezing, batch-group timeline summaries, batch/member reads, and cell-history
coordinate proof. It intentionally does not expose write paths.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from typing import cast as typing_cast

from sqlalchemy import String, and_, case, func, literal, or_, select, true, tuple_, union_all
from sqlalchemy import cast as sa_cast
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.errors import ConflictError
from app.domain.backbone.snapshot import parse_backbone_snapshot
from app.domain.parameters.definition_view import DefinitionView
from app.features.history.cursor import HistoryMemberFilterScope
from app.features.history.projection import HistoryEntryRole, HistoryEventRow
from app.models.parameter import Parameter
from app.models.project import (
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    Project,
    ProjectStatus,
    SheetLayer,
)

HistoryGroupKind = Literal["batch", "event"]
HistoryCoordinateState = Literal["current", "deleted"]
HistoryCellCoordinateKey = tuple[int, str]

CAPTURE_EVENT_ROW_LIMIT = 200
COORDINATE_PROOF_LIMIT = 5000
SQL_INTEGER_MIN = -2_147_483_648
SQL_INTEGER_MAX = 2_147_483_647


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
class HistoryTimelineContext:
    project_exists: bool
    snapshot_max_event_id: int | None
    coverage: HistoryCoverageCounts


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


@dataclass(frozen=True, slots=True)
class HistoryBatchDescriptor:
    project_id: int
    batch_id: str
    project_exists: bool
    batch_exists: bool
    total_event_count: int
    cell_event_count: int
    capture_event_count: int
    other_event_count: int

    @property
    def matched_event_count(self) -> int:
        return self.cell_event_count + self.capture_event_count + self.other_event_count


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

    async def describe_batch(
        self,
        project_id: int,
        batch_id: str,
        *,
        member_filters: HistoryMemberFilterScope | None = None,
    ) -> HistoryBatchDescriptor:
        member_match = and_(
            ChangeEvent.id.is_not(None),
            self._member_filter_expression(member_filters),
        )
        cell_match = and_(member_match, ChangeEvent.event_type == "cell_update")
        capture_match = and_(
            member_match,
            ChangeEvent.event_type.in_(("backbone_copy", "backbone_layer_replace")),
        )
        other_match = and_(
            member_match,
            ChangeEvent.event_type.notin_(
                ("cell_update", "backbone_copy", "backbone_layer_replace")
            ),
        )
        stmt = (
            select(
                Project.id.label("project_id"),
                func.count(ChangeEvent.id).label("total_event_count"),
                func.coalesce(func.sum(case((cell_match, 1), else_=0)), 0).label(
                    "cell_event_count"
                ),
                func.coalesce(func.sum(case((capture_match, 1), else_=0)), 0).label(
                    "capture_event_count"
                ),
                func.coalesce(func.sum(case((other_match, 1), else_=0)), 0).label(
                    "other_event_count"
                ),
            )
            .select_from(Project)
            .outerjoin(
                ChangeEvent,
                (ChangeEvent.project_id == Project.id)
                & (ChangeEvent.batch_id == batch_id),
            )
            .where(Project.id == project_id)
            .group_by(Project.id)
        )
        row = (await self.session.execute(stmt)).mappings().first()
        if row is None:
            return HistoryBatchDescriptor(
                project_id=project_id,
                batch_id=batch_id,
                project_exists=False,
                batch_exists=False,
                total_event_count=0,
                cell_event_count=0,
                capture_event_count=0,
                other_event_count=0,
            )
        total_event_count = int(row["total_event_count"])
        return HistoryBatchDescriptor(
            project_id=project_id,
            batch_id=batch_id,
            project_exists=True,
            batch_exists=total_event_count > 0,
            total_event_count=total_event_count,
            cell_event_count=int(row["cell_event_count"]),
            capture_event_count=int(row["capture_event_count"]),
            other_event_count=int(row["other_event_count"]),
        )

    async def load_cell_batch_page(
        self,
        project_id: int,
        batch_id: str,
        *,
        member_filters: HistoryMemberFilterScope | None = None,
        before_event_id: int | None = None,
        limit: int = 201,
    ) -> tuple[HistoryEventRow, ...]:
        stmt = self._event_row_stmt(
            project_id,
            snapshot_max_event_id=None,
            with_payload=False,
        ).where(
            ChangeEvent.batch_id == batch_id,
            ChangeEvent.event_type == "cell_update",
        )
        if before_event_id is not None:
            stmt = stmt.where(ChangeEvent.id < before_event_id)
        stmt = self._apply_member_filters(stmt, member_filters)
        stmt = stmt.order_by(ChangeEvent.id.desc()).limit(limit)
        return await self._load_event_rows(stmt)

    async def load_capture_batch_rows(
        self,
        project_id: int,
        batch_id: str,
        *,
        member_filters: HistoryMemberFilterScope | None = None,
        limit: int = CAPTURE_EVENT_ROW_LIMIT,
    ) -> tuple[HistoryEventRow, ...]:
        if limit < 1 or limit > CAPTURE_EVENT_ROW_LIMIT:
            raise ValueError("capture event row limit is out of bounds")
        stmt = self._event_row_stmt(
            project_id,
            snapshot_max_event_id=None,
            with_payload=True,
        ).where(
            ChangeEvent.batch_id == batch_id,
            ChangeEvent.event_type.in_(("backbone_copy", "backbone_layer_replace")),
        )
        stmt = self._apply_member_filters(stmt, member_filters)
        stmt = stmt.order_by(ChangeEvent.id.asc()).limit(limit + 1)
        rows = await self._load_event_rows(stmt)
        if len(rows) > limit:
            raise ConflictError(
                "capture event batch exceeds the safe row limit",
                code="invalid_event_batch",
            )
        return rows

    async def snapshot_max_event_id(
        self,
        project_id: int,
        *,
        member_filters: HistoryMemberFilterScope | None = None,
    ) -> int | None:
        stmt = select(func.max(ChangeEvent.id)).where(ChangeEvent.project_id == project_id)
        stmt = self._apply_member_filters(stmt, member_filters)
        return self._scalar_int(await self.session.execute(stmt))

    async def load_timeline_context(
        self,
        project_id: int,
        *,
        member_filters: HistoryMemberFilterScope | None = None,
        snapshot_max_event_id: int | None = None,
        resolve_snapshot: bool = True,
    ) -> HistoryTimelineContext:
        """Load project, frozen snapshot, and coverage truth in one round trip."""

        snapshot_event = aliased(ChangeEvent)
        coverage_event = aliased(ChangeEvent)
        if resolve_snapshot:
            snapshot_value = (
                select(func.max(snapshot_event.id))
                .where(
                    snapshot_event.project_id == project_id,
                    self._member_filter_expression(
                        member_filters, event=snapshot_event
                    ),
                )
                .scalar_subquery()
            )
        else:
            snapshot_value = literal(snapshot_max_event_id)

        snapshot = select(
            snapshot_value.label("snapshot_max_event_id")
        ).cte("timeline_snapshot")
        unresolved_layers, unavailable_detail = self._coverage_expressions(coverage_event)
        stmt = (
            select(
                Project.id.label("project_id"),
                snapshot.c.snapshot_max_event_id,
                unresolved_layers.label("legacy_unresolved_layer_count"),
                unavailable_detail.label("legacy_detail_unavailable_count"),
            )
            .select_from(Project)
            .join(snapshot, true())
            .outerjoin(
                coverage_event,
                and_(
                    coverage_event.project_id == Project.id,
                    or_(
                        snapshot.c.snapshot_max_event_id.is_(None),
                        coverage_event.id <= snapshot.c.snapshot_max_event_id,
                    ),
                ),
            )
            .where(Project.id == project_id)
            .group_by(Project.id, snapshot.c.snapshot_max_event_id)
        )
        row = (await self.session.execute(stmt)).mappings().first()
        if row is None:
            return HistoryTimelineContext(
                project_exists=False,
                snapshot_max_event_id=None,
                coverage=HistoryCoverageCounts(
                    legacy_unresolved_layer_count=0,
                    legacy_detail_unavailable_count=0,
                ),
            )
        resolved_snapshot = row["snapshot_max_event_id"]
        return HistoryTimelineContext(
            project_exists=True,
            snapshot_max_event_id=(
                int(resolved_snapshot) if resolved_snapshot is not None else None
            ),
            coverage=HistoryCoverageCounts(
                legacy_unresolved_layer_count=int(
                    row["legacy_unresolved_layer_count"]
                ),
                legacy_detail_unavailable_count=int(
                    row["legacy_detail_unavailable_count"]
                ),
            ),
        )

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
            min_event_id = int(row["min_event_id"])
            representative = representative_map[max_event_id]
            batch_id = row["batch_id"]
            started_at = row["started_at"]
            occurred_at = row["occurred_at"]
            if batch_id is None:
                total_count = 1
                group_kind: HistoryGroupKind = "event"
                group_key = f"event:{max_event_id}"
            else:
                total_count = total_counts_by_batch.get(batch_id, int(row["matched_event_count"]))
                group_kind = "batch"
                group_key = f"batch:{batch_id}"
            rows.append(
                HistoryTimelineGroupRow(
                    group_key=group_key,
                    batch_id=batch_id,
                    group_kind=group_kind,
                    min_event_id=min_event_id,
                    max_event_id=max_event_id,
                    started_at=_utc_datetime(started_at),
                    occurred_at=_utc_datetime(occurred_at),
                    event_types=_event_type_metadata_values(row["event_types"]),
                    actors=_metadata_values(row["actors"]),
                    origins=_metadata_values(row["origins"]),
                    layer_keys=_metadata_values(row["layer_keys"]),
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
        legacy_unresolved_layer_count_expr, legacy_detail_count_expr = (
            self._coverage_expressions(ChangeEvent)
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

    @staticmethod
    def _coverage_expressions(event):
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
                    event.event_type.in_(layer_bearing_event_types)
                    & event.layer_key.is_(None),
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
                    event.event_type.in_(("backbone_copy", "backbone_layer_replace"))
                    & (
                        func.coalesce(
                            event.payload["payload_schema_version"].as_integer(), 1
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
        return legacy_unresolved_layer_count_expr, legacy_detail_count_expr

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
        return (
            await self.prove_cell_coordinates(
                project_id,
                ((condition_id, parameter_code),),
            )
        ).get((condition_id, parameter_code))

    async def prove_cell_coordinates(
        self,
        project_id: int,
        coordinates: Sequence[HistoryCellCoordinateKey],
    ) -> dict[HistoryCellCoordinateKey, HistoryCellCoordinateProof]:
        normalized = tuple(sorted(set(coordinates)))
        if not normalized:
            return {}
        if len(normalized) > COORDINATE_PROOF_LIMIT:
            raise ConflictError(
                "history coordinate proof exceeds the safe limit",
                code="invalid_event_batch",
            )

        condition_ids = tuple(sorted({condition_id for condition_id, _ in normalized}))
        parameter_codes = tuple(sorted({parameter_code for _, parameter_code in normalized}))
        project_definition = (
            await self.session.execute(
                select(Project.status, Project.parameter_snapshot).where(Project.id == project_id)
            )
        ).one_or_none()
        frozen_parameter_codes: set[str] | None = None
        if (
            project_definition is not None
            and project_definition.status in {ProjectStatus.APPROVED, ProjectStatus.ARCHIVED}
        ):
            frozen_parameter_codes = {
                str(column["code"])
                for column in DefinitionView.from_snapshot(
                    project_definition.parameter_snapshot
                ).columns()
            }
        null_event_id = sa_cast(literal(None), ChangeEvent.__table__.c.id.type)
        null_parameter_code = sa_cast(literal(None), String)
        null_payload_text = sa_cast(literal(None), String)

        current_condition_rows = (
            select(
                literal("current_condition").label("evidence_kind"),
                LayerCondition.id.label("condition_id"),
                null_parameter_code.label("parameter_code"),
                SheetLayer.layer_key.label("layer_key"),
                null_event_id.label("event_id"),
                null_payload_text.label("payload_text"),
            )
            .select_from(LayerCondition)
            .join(SheetLayer, SheetLayer.id == LayerCondition.layer_id)
            .where(
                SheetLayer.project_id == project_id,
                LayerCondition.id.in_(condition_ids),
            )
        )
        current_coordinate_rows = (
            select(
                literal("current_coordinate").label("evidence_kind"),
                LayerCondition.id.label("condition_id"),
                Parameter.code.label("parameter_code"),
                SheetLayer.layer_key.label("layer_key"),
                null_event_id.label("event_id"),
                null_payload_text.label("payload_text"),
            )
            .select_from(LayerCondition)
            .join(SheetLayer, SheetLayer.id == LayerCondition.layer_id)
            .join(Parameter, Parameter.code.in_(parameter_codes))
            .where(
                SheetLayer.project_id == project_id,
                tuple_(LayerCondition.id, Parameter.code).in_(normalized),
            )
        )

        cell_ranked = (
            select(
                ChangeEvent.condition_id.label("condition_id"),
                ChangeEvent.parameter_code.label("parameter_code"),
                ChangeEvent.layer_key.label("layer_key"),
                ChangeEvent.id.label("event_id"),
                func.row_number()
                .over(
                    partition_by=(ChangeEvent.condition_id, ChangeEvent.parameter_code),
                    order_by=ChangeEvent.id.desc(),
                )
                .label("row_number"),
            )
            .where(
                ChangeEvent.project_id == project_id,
                ChangeEvent.event_type == "cell_update",
                tuple_(ChangeEvent.condition_id, ChangeEvent.parameter_code).in_(normalized),
            )
            .subquery()
        )
        cell_event_rows = select(
            literal("cell_event").label("evidence_kind"),
            cell_ranked.c.condition_id,
            cell_ranked.c.parameter_code,
            cell_ranked.c.layer_key,
            cell_ranked.c.event_id,
            null_payload_text.label("payload_text"),
        ).where(cell_ranked.c.row_number == 1)

        remove_condition_id = func.coalesce(
            ChangeEvent.condition_id,
            ChangeEvent.payload["condition_id"].as_integer(),
        )
        remove_layer_key = func.coalesce(
            ChangeEvent.layer_key,
            ChangeEvent.payload["layer_key"].as_string(),
        )
        remove_ranked = (
            select(
                remove_condition_id.label("condition_id"),
                remove_layer_key.label("layer_key"),
                ChangeEvent.id.label("event_id"),
                sa_cast(ChangeEvent.payload, String).label("payload_text"),
                func.row_number()
                .over(
                    partition_by=remove_condition_id,
                    order_by=ChangeEvent.id.desc(),
                )
                .label("row_number"),
            )
            .where(
                ChangeEvent.project_id == project_id,
                ChangeEvent.event_type == "condition_remove",
                remove_condition_id.in_(condition_ids),
            )
            .subquery()
        )
        remove_event_rows = select(
            literal("remove_event").label("evidence_kind"),
            remove_ranked.c.condition_id,
            null_parameter_code.label("parameter_code"),
            remove_ranked.c.layer_key,
            remove_ranked.c.event_id,
            remove_ranked.c.payload_text,
        ).where(remove_ranked.c.row_number == 1)

        evidence_queries = [current_condition_rows]
        if frozen_parameter_codes is None:
            evidence_queries.append(current_coordinate_rows)
        evidence_queries.extend((cell_event_rows, remove_event_rows))
        evidence = (
            await self.session.execute(union_all(*evidence_queries))
        ).mappings()

        current_layers: dict[int, str | None] = {}
        current_coordinates: set[HistoryCellCoordinateKey] = set()
        cell_events: dict[HistoryCellCoordinateKey, tuple[int, str | None]] = {}
        remove_events: dict[int, tuple[int, str | None, Mapping[str, object]]] = {}
        for row in evidence:
            kind = str(row["evidence_kind"])
            condition_id = int(row["condition_id"])
            layer_value = row["layer_key"]
            layer_key = str(layer_value) if layer_value is not None else None
            if kind == "current_condition":
                current_layers[condition_id] = layer_key
                continue
            if kind == "current_coordinate":
                current_coordinates.add((condition_id, str(row["parameter_code"])))
                continue
            if kind == "cell_event":
                cell_events[(condition_id, str(row["parameter_code"]))] = (
                    int(row["event_id"]),
                    layer_key,
                )
                continue
            payload: Mapping[str, object] = {}
            payload_text = row["payload_text"]
            if isinstance(payload_text, str):
                try:
                    decoded = json.loads(payload_text)
                except json.JSONDecodeError:
                    decoded = None
                if isinstance(decoded, Mapping):
                    payload = typing_cast(Mapping[str, object], decoded)
            remove_events[condition_id] = (int(row["event_id"]), layer_key, payload)

        if frozen_parameter_codes is not None:
            current_coordinates.update(
                (condition_id, parameter_code)
                for condition_id, parameter_code in normalized
                if condition_id in current_layers and parameter_code in frozen_parameter_codes
            )

        proofs: dict[HistoryCellCoordinateKey, HistoryCellCoordinateProof] = {}
        for condition_id, parameter_code in normalized:
            key = (condition_id, parameter_code)
            cell_event = cell_events.get(key)
            if condition_id in current_layers:
                if key not in current_coordinates:
                    continue
                latest_event_id = cell_event[0] if cell_event is not None else None
                proofs[key] = HistoryCellCoordinateProof(
                    state="current",
                    project_id=project_id,
                    condition_id=condition_id,
                    parameter_code=parameter_code,
                    layer_key=current_layers[condition_id],
                    current_event_id=latest_event_id,
                    remove_event_id=None,
                    latest_event_id=latest_event_id,
                )
                continue

            remove_event = remove_events.get(condition_id)
            remove_proves_parameter = False
            if remove_event is not None:
                remove_proves_parameter = _snapshot_contains_parameter(
                    remove_event[2].get("snapshot"), parameter_code
                )
            if cell_event is None and not remove_proves_parameter:
                continue
            proofs[key] = HistoryCellCoordinateProof(
                state="deleted",
                project_id=project_id,
                condition_id=condition_id,
                parameter_code=parameter_code,
                layer_key=(
                    remove_event[1]
                    if remove_proves_parameter and remove_event is not None
                    else cell_event[1]
                    if cell_event is not None
                    else None
                ),
                current_event_id=None,
                remove_event_id=(
                    remove_event[0]
                    if remove_proves_parameter and remove_event is not None
                    else None
                ),
                latest_event_id=cell_event[0] if cell_event is not None else None,
            )
        return proofs

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
        if self.session.get_bind().dialect.name == "postgresql":
            return self._postgres_timeline_summary_stmt(
                project_id,
                member_filters=member_filters,
                snapshot_max_event_id=snapshot_max_event_id,
                before_group_max_id=before_group_max_id,
                limit=limit,
            )

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
                *self._timeline_metadata_columns(ChangeEvent),
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

    def _postgres_timeline_summary_stmt(
        self,
        project_id: int,
        *,
        member_filters: HistoryMemberFilterScope | None,
        snapshot_max_event_id: int | None,
        before_group_max_id: int | None,
        limit: int,
    ):
        """Select exact group candidates through the Phase 4 indexes before aggregating."""

        candidate_event = aliased(ChangeEvent)
        candidate_predicates = [
            candidate_event.project_id == project_id,
            self._member_filter_expression(member_filters, event=candidate_event),
        ]
        if snapshot_max_event_id is not None:
            candidate_predicates.append(candidate_event.id <= snapshot_max_event_id)

        if member_filters is None or member_filters == HistoryMemberFilterScope():
            # Expressing the tenant and frozen-id bounds as one lexicographic
            # range across the complete SQL Integer domain is equivalent to
            # ``project_id = ... AND id <= ...`` while letting PostgreSQL stream
            # the unbatched candidates from the matching Phase 4 composite index.
            project_event_key = tuple_(
                candidate_event.project_id,
                candidate_event.id,
            )
            unbatched_predicates = [
                project_event_key
                >= tuple_(literal(project_id), literal(SQL_INTEGER_MIN)),
                candidate_event.batch_id.is_(None),
            ]
            upper_event_id = (
                SQL_INTEGER_MAX
                if snapshot_max_event_id is None
                else snapshot_max_event_id
            )
            unbatched_predicates.append(
                project_event_key
                <= tuple_(
                    literal(project_id),
                    literal(upper_event_id),
                )
            )
            if before_group_max_id is not None:
                unbatched_predicates.append(
                    project_event_key
                    < tuple_(
                        literal(project_id),
                        literal(before_group_max_id),
                    )
                )
            unbatched_order = (
                candidate_event.project_id.asc(),
                candidate_event.id.desc(),
            )
        else:
            unbatched_predicates = [
                *candidate_predicates,
                candidate_event.batch_id.is_(None),
            ]
            if before_group_max_id is not None:
                unbatched_predicates.append(candidate_event.id < before_group_max_id)
            unbatched_order = (candidate_event.id.desc(),)
        unbatched_candidates = (
            select(
                (literal("event:") + sa_cast(candidate_event.id, String)).label(
                    "group_key"
                ),
                sa_cast(literal(None), String).label("batch_id"),
                candidate_event.id.label("max_event_id"),
            )
            .where(*unbatched_predicates)
            .order_by(*unbatched_order)
            .limit(limit)
        )

        latest_batch = (
            select(
                candidate_event.batch_id.label("batch_id"),
                candidate_event.id.label("max_event_id"),
            )
            .where(*candidate_predicates, candidate_event.batch_id.is_not(None))
            .distinct(candidate_event.batch_id)
            .order_by(candidate_event.batch_id.asc(), candidate_event.id.desc())
            .subquery("latest_timeline_batch")
        )
        batch_candidates = select(
            (literal("batch:") + latest_batch.c.batch_id).label("group_key"),
            latest_batch.c.batch_id,
            latest_batch.c.max_event_id,
        )
        if before_group_max_id is not None:
            batch_candidates = batch_candidates.where(
                latest_batch.c.max_event_id < before_group_max_id
            )
        batch_candidates = batch_candidates.order_by(
            latest_batch.c.max_event_id.desc(), latest_batch.c.batch_id.asc()
        ).limit(limit)

        candidate_union = union_all(unbatched_candidates, batch_candidates).subquery(
            "timeline_candidate_union"
        )
        candidates = (
            select(
                candidate_union.c.group_key,
                candidate_union.c.batch_id,
                candidate_union.c.max_event_id,
            )
            .order_by(
                candidate_union.c.max_event_id.desc(),
                candidate_union.c.group_key.asc(),
            )
            .limit(limit)
            .cte("timeline_candidates")
        )

        def summary_branch(member, *, batched: bool):
            if batched:
                member_join = and_(
                    member.project_id == project_id,
                    member.batch_id == candidates.c.batch_id,
                )
                candidate_kind = candidates.c.batch_id.is_not(None)
            else:
                member_join = and_(
                    member.project_id == project_id,
                    member.id == candidates.c.max_event_id,
                )
                candidate_kind = candidates.c.batch_id.is_(None)
            predicates = [
                candidate_kind,
                self._member_filter_expression(member_filters, event=member),
            ]
            if snapshot_max_event_id is not None:
                predicates.append(member.id <= snapshot_max_event_id)
            return (
                select(
                    candidates.c.group_key,
                    candidates.c.batch_id,
                    func.min(member.id).label("min_event_id"),
                    func.max(member.id).label("max_event_id"),
                    func.min(member.created_at).label("started_at"),
                    func.max(member.created_at).label("occurred_at"),
                    func.count().label("matched_event_count"),
                    *self._timeline_metadata_columns(member),
                )
                .select_from(candidates)
                .join(member, member_join)
                .where(*predicates)
                .group_by(candidates.c.group_key, candidates.c.batch_id)
            )

        grouped = union_all(
            summary_branch(aliased(ChangeEvent), batched=True),
            summary_branch(aliased(ChangeEvent), batched=False),
        ).subquery("timeline_group_summary")
        return (
            select(grouped)
            .order_by(grouped.c.max_event_id.desc(), grouped.c.group_key.asc())
            .limit(limit)
        )

    def _timeline_metadata_columns(self, event):
        aggregate = (
            func.jsonb_agg
            if self.session.get_bind().dialect.name == "postgresql"
            else func.json_group_array
        )

        def values(column, label: str):
            return aggregate(column.distinct()).filter(column.is_not(None)).label(label)

        return (
            values(func.lower(event.event_type), "event_types"),
            values(event.actor, "actors"),
            values(event.origin, "origins"),
            values(event.layer_key, "layer_keys"),
        )

    def _event_row_stmt(
        self,
        project_id: int,
        *,
        snapshot_max_event_id: int | None,
        with_payload: bool = False,
    ):
        columns = _DETAIL_EVENT_COLUMNS if with_payload else _SUMMARY_EVENT_COLUMNS
        stmt = select(*columns).select_from(ChangeEvent)
        if with_payload:
            stmt = stmt.add_columns(
                SheetLayer.sort_order.label("layer_sort_order")
            ).outerjoin(
                SheetLayer,
                (SheetLayer.project_id == ChangeEvent.project_id)
                & (SheetLayer.layer_key == ChangeEvent.layer_key),
            )
        stmt = stmt.where(ChangeEvent.project_id == project_id)
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
        return stmt.where(self._member_filter_expression(member_filters))

    @staticmethod
    def _member_filter_expression(
        member_filters: HistoryMemberFilterScope | None,
        *,
        event=ChangeEvent,
    ):
        if member_filters is None:
            return true()
        predicates = []
        if member_filters.layer_keys:
            predicates.append(event.layer_key.in_(member_filters.layer_keys))
        if member_filters.event_types:
            predicates.append(event.event_type.in_(member_filters.event_types))
        if member_filters.actors:
            predicates.append(event.actor.in_(member_filters.actors))
        if member_filters.origins:
            predicates.append(event.origin.in_(member_filters.origins))
        if member_filters.source_project_ids:
            predicates.append(
                event.source_project_id.in_(member_filters.source_project_ids)
            )
        if member_filters.created_from is not None:
            predicates.append(event.created_at >= member_filters.created_from)
        if member_filters.created_to is not None:
            predicates.append(event.created_at < member_filters.created_to)
        return and_(*predicates) if predicates else true()

    @staticmethod
    def _scalar_int(result) -> int | None:
        value = result.scalar_one_or_none()
        return int(value) if value is not None else None


def _metadata_values(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    decoded = json.loads(value) if isinstance(value, str) else value
    if not isinstance(decoded, (list, tuple)):
        return ()
    return tuple(sorted({str(item) for item in decoded if item is not None}))


def _event_type_metadata_values(value: Any) -> tuple[str, ...]:
    normalized: set[str] = set()
    for item in _metadata_values(value):
        if item in ChangeEventType.__members__:
            normalized.add(ChangeEventType[item].value)
            continue
        try:
            normalized.add(ChangeEventType(item).value)
        except ValueError:
            normalized.add(item)
    return tuple(sorted(normalized))


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
        layer_sort_order=(
            int(mapping["layer_sort_order"])
            if mapping.get("layer_sort_order") is not None
            else None
        ),
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
