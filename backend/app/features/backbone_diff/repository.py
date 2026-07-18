"""Read-only backbone diff snapshot repository."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.domain.backbone.diff import (
    BackboneDiffCurrentCell,
    BackboneDiffCurrentLayerSource,
    BackboneDiffCurrentParameter,
    BackboneDiffLayerInput,
    _canonicalize_current_parameters,
    _current_cells_by_condition_from_database_rows,
    _current_condition_from_canonical_database_values,
    _layer_input_from_canonical_database_graph,
)
from app.domain.backbone.snapshot import (
    BackboneSnapshot,
    BackboneSnapshotParseCache,
    parse_backbone_snapshot,
)
from app.features.backbone_diff.contracts import BackboneDiffProjectInput
from app.models.parameter import Parameter, ParameterCategory
from app.models.project import CellValue, LayerCondition, Project, SheetLayer


@dataclass(frozen=True, slots=True)
class _ProjectRow:
    id: int
    line_id: str
    process_id: str
    part_id: str
    name: str
    status: object


@dataclass(frozen=True, slots=True)
class _LayerRow:
    id: int
    layer_key: str
    step_seq: str
    layer_id: str
    sort_order: int
    source_project_id: int | None
    source_layer_key: str | None
    backbone_snapshot: dict[str, Any] | None


@dataclass(frozen=True, slots=True)
class _ConditionRow:
    id: int
    layer_id: int
    label: str
    condition_index: int
    is_por: bool
    source_condition_id: int | None


class BackboneDiffRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def load(self, project_id: int) -> BackboneDiffProjectInput:
        project = await self._load_project(project_id)
        layers = await self._load_layers(project.id)
        conditions_by_layer_id = await self._load_conditions({layer.id for layer in layers})
        cells_by_condition_id = await self._load_cells(conditions_by_layer_id.values())
        snapshot_parse_cache = BackboneSnapshotParseCache()
        baseline_snapshot_by_layer_id: dict[int, BackboneSnapshot | None] = {
            layer.id: (
                parse_backbone_snapshot(layer.backbone_snapshot, cache=snapshot_parse_cache)
                if layer.backbone_snapshot is not None
                else None
            )
            for layer in layers
        }
        requested_codes = self._collect_parameter_codes(
            layers,
            baseline_snapshot_by_layer_id,
            cells_by_condition_id,
        )
        registry = await self._load_parameter_registry(requested_codes)
        if registry.unresolved_codes:
            raise ConflictError(
                "백본 컬럼 메타데이터를 찾을 수 없다",
                code="unresolved_parameter_metadata",
                details={"parameter_codes": list(registry.unresolved_codes)},
            )

        captured_at = datetime.now(UTC)
        current_parameters = registry.parameters
        loaded_layers = tuple(
            self._build_layer_input(
                project=project,
                layer=layer,
                baseline_snapshot=baseline_snapshot_by_layer_id[layer.id],
                current_conditions=conditions_by_layer_id.get(layer.id, ()),
                cells_by_condition_id=cells_by_condition_id,
                current_parameters=current_parameters,
            )
            for layer in layers
        )
        return BackboneDiffProjectInput(
            project_id=project.id,
            line_id=project.line_id,
            process_id=project.process_id,
            part_id=project.part_id,
            project_name=project.name,
            project_status=_project_status_text(project.status),
            captured_at=captured_at,
            layers=loaded_layers,
        )

    async def _load_project(self, project_id: int) -> _ProjectRow:
        project_table = Project.__table__
        row = (
            await self.session.execute(
                select(
                    project_table.c.id,
                    project_table.c.line_id,
                    project_table.c.process_id,
                    project_table.c.part_id,
                    project_table.c.name,
                    project_table.c.status,
                ).where(project_table.c.id == project_id)
            )
        ).one_or_none()
        if row is None:
            raise NotFoundError(
                f"프로젝트를 찾을 수 없다: {project_id}",
                code="project_not_found",
                details={"project_id": project_id},
            )
        return _ProjectRow(
            id=row.id,
            line_id=row.line_id,
            process_id=row.process_id,
            part_id=row.part_id,
            name=row.name,
            status=row.status,
        )

    async def _load_layers(self, project_id: int) -> tuple[_LayerRow, ...]:
        layer_table = SheetLayer.__table__
        rows = (
            await self.session.execute(
                select(
                    layer_table.c.id,
                    layer_table.c.layer_key,
                    layer_table.c.step_seq,
                    layer_table.c.layer_id,
                    layer_table.c.sort_order,
                    layer_table.c.source_project_id,
                    layer_table.c.source_layer_key,
                    layer_table.c.backbone_snapshot,
                )
                .where(layer_table.c.project_id == project_id)
                .order_by(
                    layer_table.c.sort_order,
                    layer_table.c.layer_key,
                    layer_table.c.id,
                )
            )
        ).all()
        return tuple(
            _LayerRow(
                id=row.id,
                layer_key=row.layer_key,
                step_seq=row.step_seq,
                layer_id=row.layer_id,
                sort_order=row.sort_order,
                source_project_id=row.source_project_id,
                source_layer_key=row.source_layer_key,
                backbone_snapshot=row.backbone_snapshot,
            )
            for row in rows
        )

    async def _load_conditions(self, layer_ids: set[int]) -> dict[int, tuple[_ConditionRow, ...]]:
        if not layer_ids:
            return {}
        condition_table = LayerCondition.__table__
        rows = (
            await self.session.execute(
                select(
                    condition_table.c.id,
                    condition_table.c.layer_id,
                    condition_table.c.label,
                    condition_table.c.condition_index,
                    condition_table.c.is_por,
                    condition_table.c.source_condition_id,
                )
                .where(condition_table.c.layer_id.in_(layer_ids))
                .order_by(
                    condition_table.c.layer_id,
                    condition_table.c.condition_index,
                    condition_table.c.id,
                )
            )
        ).all()
        grouped: dict[int, list[_ConditionRow]] = defaultdict(list)
        for row in rows:
            grouped[row.layer_id].append(
                _ConditionRow(
                    id=row.id,
                    layer_id=row.layer_id,
                    label=row.label,
                    condition_index=row.condition_index,
                    is_por=row.is_por,
                    source_condition_id=row.source_condition_id,
                )
            )
        return {layer_id: tuple(condition_rows) for layer_id, condition_rows in grouped.items()}

    async def _load_cells(
        self, condition_groups: Iterable[tuple[_ConditionRow, ...]]
    ) -> dict[int, tuple[BackboneDiffCurrentCell, ...]]:
        condition_ids = {
            condition.id for condition_group in condition_groups for condition in condition_group
        }
        if not condition_ids:
            return {}
        cell_table = CellValue.__table__
        rows = (
            await self.session.execute(
                select(
                    cell_table.c.condition_id,
                    cell_table.c.parameter_code,
                    cell_table.c.value_text,
                )
                .where(cell_table.c.condition_id.in_(condition_ids))
                .order_by(
                    cell_table.c.condition_id,
                    cell_table.c.parameter_code,
                    cell_table.c.id,
                )
            )
        ).tuples()
        return _current_cells_by_condition_from_database_rows(rows)

    async def _load_parameter_registry(
        self, requested_codes: set[str]
    ) -> BackboneDiffCurrentParameterRegistry:
        parameter_table = Parameter.__table__
        category_table = ParameterCategory.__table__
        stmt = (
            select(
                parameter_table.c.code,
                parameter_table.c.value_type,
                parameter_table.c.display_name,
                category_table.c.code.label("category_code"),
                parameter_table.c.sort_order,
                parameter_table.c.is_active,
            )
            .select_from(parameter_table)
            .outerjoin(category_table, parameter_table.c.category_id == category_table.c.id)
            .order_by(parameter_table.c.sort_order, parameter_table.c.code)
        )
        if requested_codes:
            stmt = stmt.where(
                or_(
                    parameter_table.c.is_active.is_(True),
                    parameter_table.c.code.in_(requested_codes),
                )
            )
        else:
            stmt = stmt.where(parameter_table.c.is_active.is_(True))

        rows = (await self.session.execute(stmt)).all()
        rows_by_code = {row.code: row for row in rows}
        unresolved_codes = tuple(
            code for code in sorted(requested_codes) if code not in rows_by_code
        )
        parameters = _canonicalize_current_parameters(
            tuple(
                BackboneDiffCurrentParameter(
                    code=row.code,
                    value_type=row.value_type,
                    display_name=row.display_name,
                    category_code=row.category_code,
                    sort_order=row.sort_order,
                    active=row.is_active,
                )
                for row in rows
            )
        )
        return BackboneDiffCurrentParameterRegistry(
            parameters=parameters,
            unresolved_codes=unresolved_codes,
        )

    def _collect_parameter_codes(
        self,
        layers: tuple[_LayerRow, ...],
        baseline_snapshot_by_layer_id: dict[int, BackboneSnapshot | None],
        cells_by_condition_id: dict[int, tuple[BackboneDiffCurrentCell, ...]],
    ) -> set[str]:
        requested_codes: set[str] = set()
        for layer in layers:
            baseline_snapshot = baseline_snapshot_by_layer_id[layer.id]
            if baseline_snapshot is not None:
                requested_codes.update(
                    column.parameter_code for column in baseline_snapshot.columns
                )
        for cell_rows in cells_by_condition_id.values():
            requested_codes.update(cell.parameter_code for cell in cell_rows)
        return requested_codes

    def _build_layer_input(
        self,
        project: _ProjectRow,
        layer: _LayerRow,
        *,
        baseline_snapshot: BackboneSnapshot | None,
        current_conditions: tuple[_ConditionRow, ...],
        cells_by_condition_id: dict[int, tuple[BackboneDiffCurrentCell, ...]],
        current_parameters: tuple[BackboneDiffCurrentParameter, ...],
    ) -> BackboneDiffLayerInput:
        layer_conditions = tuple(
            _current_condition_from_canonical_database_values(
                id=condition.id,
                source_condition_id=condition.source_condition_id,
                label=condition.label,
                condition_index=condition.condition_index,
                is_por=condition.is_por,
                cells=cells_by_condition_id.get(condition.id, ()),
            )
            for condition in current_conditions
        )
        return _layer_input_from_canonical_database_graph(
            layer_key=layer.layer_key,
            layer_sort_order=layer.sort_order,
            current_source=BackboneDiffCurrentLayerSource(
                project_id=project.id,
                sheet_layer_id=layer.id,
                layer_key=layer.layer_key,
                step_seq=layer.step_seq,
                layer_id=layer.layer_id,
                sort_order=layer.sort_order,
                source_project_id=layer.source_project_id,
                source_layer_key=layer.source_layer_key,
            ),
            baseline_snapshot=baseline_snapshot,
            current_conditions=layer_conditions,
            current_parameters=current_parameters,
        )


@dataclass(frozen=True, slots=True)
class BackboneDiffCurrentParameterRegistry:
    parameters: tuple[BackboneDiffCurrentParameter, ...]
    unresolved_codes: tuple[str, ...]


def _project_status_text(status: object) -> str:
    status_value = getattr(status, "value", status)
    return str(status_value)
