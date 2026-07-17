"""Read-only backbone diff snapshot repository."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ConflictError
from app.domain.backbone.snapshot import (
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
    parse_backbone_snapshot,
)
from app.features.backbone_diff.contracts import DiffInput, DiffLayerInput, DiffParameterInput
from app.features.projects.repository import CapturedParameter, ProjectRepository
from app.models.project import LayerCondition, Project, SheetLayer


class BackboneDiffRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def load(self, project_id: int) -> DiffInput:
        project = await self._load_project(project_id)
        layer_codes, current_codes = self._collect_parameter_codes(project.layers)
        requested_codes = layer_codes | current_codes
        registry = await ProjectRepository(self.session).capture_parameter_registry(
            requested_codes
        )
        if registry.unresolved_codes:
            raise ConflictError(
                "백본 컬럼 메타데이터를 찾을 수 없다",
                code="unresolved_parameter_metadata",
                details={"parameter_codes": list(registry.unresolved_codes)},
            )

        parameters = tuple(
            DiffParameterInput(
                parameter_code=parameter.parameter_code,
                value_type=parameter.value_type,
                display_name=parameter.display_name,
                category_code=parameter.category_code,
                sort_order=parameter.sort_order,
                active_at_capture=parameter.active_at_capture,
            )
            for parameter in registry.parameters
        )
        captured_at = datetime.now(UTC)
        layers = tuple(
            self._build_layer_input(
                layer,
                parameters_by_code=registry.parameters,
                captured_at=captured_at,
            )
            for layer in project.layers
        )
        return DiffInput(
            project_id=project.id,
            line_id=project.line_id,
            process_id=project.process_id,
            part_id=project.part_id,
            project_name=project.name,
            project_status=project.status.value,
            captured_at=captured_at,
            layers=layers,
            parameters=parameters,
        )

    async def _load_project(self, project_id: int) -> Project:
        result = await self.session.execute(
            select(Project)
            .where(Project.id == project_id)
            .options(
                selectinload(Project.layers)
                .selectinload(SheetLayer.conditions)
                .selectinload(LayerCondition.cell_values)
            )
        )
        project = result.scalar_one_or_none()
        if project is None:
            raise ConflictError(
                f"프로젝트를 찾을 수 없다: {project_id}",
                code="project_not_found",
                details={"project_id": project_id},
            )
        return project

    def _collect_parameter_codes(
        self, layers: Iterable[SheetLayer]
    ) -> tuple[set[str], set[str]]:
        baseline_codes: set[str] = set()
        current_codes: set[str] = set()
        for layer in layers:
            if layer.backbone_snapshot is not None:
                baseline_snapshot = parse_backbone_snapshot(layer.backbone_snapshot)
                baseline_codes.update(
                    column.parameter_code for column in baseline_snapshot.columns
                )
            for condition in layer.conditions:
                for cell in condition.cell_values:
                    if cell.value_text is not None:
                        current_codes.add(cell.parameter_code)
        return baseline_codes, current_codes

    def _build_layer_input(
        self,
        layer: SheetLayer,
        *,
        parameters_by_code: Iterable[CapturedParameter],
        captured_at: datetime,
    ) -> DiffLayerInput:
        baseline_snapshot = (
            parse_backbone_snapshot(layer.backbone_snapshot)
            if layer.backbone_snapshot is not None
            else None
        )
        current_codes = {
            cell.parameter_code
            for condition in layer.conditions
            for cell in condition.cell_values
            if cell.value_text is not None
        }
        parameter_lookup = {
            parameter.parameter_code: parameter for parameter in parameters_by_code
        }
        layer_columns = tuple(
            sorted(
                (
                    BackboneSnapshotColumn(
                        parameter_code=parameter.parameter_code,
                        value_type=parameter.value_type,
                        display_name=parameter.display_name,
                        category_code=parameter.category_code,
                        sort_order=parameter.sort_order,
                        active_at_capture=parameter.active_at_capture,
                    )
                    for parameter in parameter_lookup.values()
                    if parameter.active_at_capture or parameter.parameter_code in current_codes
                ),
                key=lambda column: (column.sort_order, column.parameter_code),
            )
        )
        current_snapshot = BackboneSnapshot(
            capture_batch_id="00000000000000000000000000000000",
            captured_at=captured_at,
            source=BackboneSnapshotSource(
                project_id=layer.project_id,
                sheet_layer_id=layer.id,
                layer_key=layer.layer_key,
                step_seq=layer.step_seq,
                layer_id=layer.layer_id,
            ),
            columns=layer_columns,
            conditions=tuple(
                BackboneSnapshotCondition(
                    source_condition_id=condition.id,
                    label=condition.label,
                    condition_index=condition.condition_index,
                    is_por=condition.is_por,
                    cells=tuple(
                        BackboneSnapshotCell(
                            parameter_code=cell.parameter_code,
                            value=cell.value_text,
                        )
                        for cell in condition.cell_values
                        if cell.value_text is not None
                    ),
                )
                for condition in layer.conditions
            ),
        )
        return DiffLayerInput(
            layer_key=layer.layer_key,
            step_seq=layer.step_seq,
            layer_id=layer.layer_id,
            sort_order=layer.sort_order,
            baseline_snapshot=baseline_snapshot,
            current_snapshot=current_snapshot,
        )
