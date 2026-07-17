"""Read-only backbone diff snapshot repository."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ConflictError, NotFoundError
from app.domain.backbone.diff import (
    BackboneDiffCurrentCell,
    BackboneDiffCurrentCondition,
    BackboneDiffCurrentLayerSource,
    BackboneDiffCurrentParameter,
    BackboneDiffLayerInput,
)
from app.domain.backbone.snapshot import parse_backbone_snapshot
from app.features.backbone_diff.contracts import BackboneDiffProjectInput
from app.features.projects.repository import CapturedParameter, ProjectRepository
from app.models.project import LayerCondition, Project, SheetLayer


class BackboneDiffRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def load(self, project_id: int) -> BackboneDiffProjectInput:
        project = await self._load_project(project_id)
        requested_codes = self._collect_parameter_codes(project.layers)
        registry = await ProjectRepository(self.session).capture_parameter_registry(requested_codes)
        if registry.unresolved_codes:
            raise ConflictError(
                "백본 컬럼 메타데이터를 찾을 수 없다",
                code="unresolved_parameter_metadata",
                details={"parameter_codes": list(registry.unresolved_codes)},
            )

        captured_at = datetime.now(UTC)
        layers = tuple(
            self._build_layer_input(
                project,
                layer,
                parameters=registry.parameters,
            )
            for layer in project.layers
        )
        return BackboneDiffProjectInput(
            project_id=project.id,
            line_id=project.line_id,
            process_id=project.process_id,
            part_id=project.part_id,
            project_name=project.name,
            project_status=project.status.value,
            captured_at=captured_at,
            layers=layers,
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
            raise NotFoundError(
                f"프로젝트를 찾을 수 없다: {project_id}",
                details={"project_id": project_id},
            )
        return project

    def _collect_parameter_codes(self, layers: Iterable[SheetLayer]) -> set[str]:
        requested_codes: set[str] = set()
        for layer in layers:
            if layer.backbone_snapshot is not None:
                baseline_snapshot = parse_backbone_snapshot(layer.backbone_snapshot)
                requested_codes.update(
                    column.parameter_code for column in baseline_snapshot.columns
                )
            for condition in layer.conditions:
                requested_codes.update(cell.parameter_code for cell in condition.cell_values)
        return requested_codes

    def _build_layer_input(
        self,
        project: Project,
        layer: SheetLayer,
        *,
        parameters: Iterable[CapturedParameter],
    ) -> BackboneDiffLayerInput:
        baseline_snapshot = (
            parse_backbone_snapshot(layer.backbone_snapshot)
            if layer.backbone_snapshot is not None
            else None
        )
        current_conditions = tuple(
            BackboneDiffCurrentCondition(
                id=condition.id,
                source_condition_id=condition.source_condition_id,
                label=condition.label,
                condition_index=condition.condition_index,
                is_por=condition.is_por,
                cells=tuple(
                    BackboneDiffCurrentCell(
                        parameter_code=cell.parameter_code,
                        value=cell.value_text,
                    )
                    for cell in condition.cell_values
                ),
            )
            for condition in layer.conditions
        )
        current_parameters = tuple(
            BackboneDiffCurrentParameter(
                code=parameter.parameter_code,
                value_type=parameter.value_type,
                display_name=parameter.display_name,
                category_code=parameter.category_code,
                sort_order=parameter.sort_order,
                active=parameter.active_at_capture,
            )
            for parameter in parameters
        )
        return BackboneDiffLayerInput(
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
            current_conditions=current_conditions,
            current_parameters=current_parameters,
        )
