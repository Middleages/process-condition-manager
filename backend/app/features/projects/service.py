"""프로젝트 생성/백본 서비스."""

import uuid
from dataclasses import asdict, dataclass

from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, DomainValidationError, NotFoundError
from app.domain.backbone import LayerMatchInput, ManualOverride, match_layers
from app.features.projects.repository import ProjectRepository
from app.features.projects.schema import (
    BackboneReplaceIn,
    ManualOverrideIn,
    MatchOut,
    MatchPreviewIn,
    MatchPreviewOut,
    ProjectCreate,
)
from app.ingest.reader import IngestReader, LayerInfo
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    Project,
    ProjectStatus,
    SheetLayer,
)


@dataclass(frozen=True, slots=True)
class _ConditionSnapshot:
    """복사 원본이 자기 자신일 때도 안전하도록 조건 행을 값으로 떠 둔다."""

    label: str
    condition_index: int
    is_por: bool
    source_condition_id: int | None
    cells: tuple[tuple[str, str | None], ...]


class ProjectService:
    """Phase 1 프로젝트/백본 오케스트레이션."""

    def __init__(self, repo: ProjectRepository, reader: IngestReader) -> None:
        self.repo = repo
        self.reader = reader

    async def list_projects(self) -> list[Project]:
        return await self.repo.list()

    async def get_project(self, project_id: int) -> Project:
        project = await self.repo.get(project_id)
        if project is None:
            raise NotFoundError(f"프로젝트를 찾을 수 없다: {project_id}")
        return project

    async def preview_match(self, data: MatchPreviewIn) -> MatchPreviewOut:
        target_layers = await self.reader.get_layers(data.line_id, data.process_id)
        if data.backbone_project_id is None:
            matches = [
                MatchOut(
                    target_layer_key=layer.key,
                    source_layer_key=None,
                    match_type="unmatched",
                )
                for layer in target_layers
            ]
            return MatchPreviewOut(
                match_rate=0.0,
                matched_count=0,
                unmatched_count=len(matches),
                copy_condition_count=0,
                copy_cell_count=0,
                matches=matches,
            )

        backbone = await self.get_project(data.backbone_project_id)
        _validate_overrides(data.manual_overrides, target_layers, backbone.layers)
        result = match_layers(
            _match_inputs_from_ingest(target_layers),
            _match_inputs_from_sheet(backbone.layers),
            _manual_overrides(data.manual_overrides),
        )
        source_by_key = {layer.layer_key: layer for layer in backbone.layers}
        copy_condition_count = 0
        copy_cell_count = 0
        for match in result.matches:
            if match.source_layer_key is None:
                continue
            source = source_by_key[match.source_layer_key]
            copy_condition_count += len(source.conditions)
            copy_cell_count += sum(len(condition.cell_values) for condition in source.conditions)
        return MatchPreviewOut(
            match_rate=result.match_rate,
            matched_count=result.matched_count,
            unmatched_count=result.unmatched_count,
            copy_condition_count=copy_condition_count,
            copy_cell_count=copy_cell_count,
            matches=[MatchOut(**asdict(match)) for match in result.matches],
        )

    async def create_project(self, data: ProjectCreate, actor: str) -> Project:
        existing = await self.repo.get_by_identity(
            data.line_id, data.process_id, data.part_id
        )
        if existing is not None:
            raise _duplicate_conflict(existing)

        target_layers = await self.reader.get_layers(data.line_id, data.process_id)
        backbone = (
            await self.get_project(data.backbone_project_id)
            if data.backbone_project_id is not None
            else None
        )
        if backbone is not None:
            _validate_overrides(data.manual_overrides, target_layers, backbone.layers)
        elif data.manual_overrides:
            raise DomainValidationError("백본 없이 수동 매칭을 지정할 수 없다")

        match_result = match_layers(
            _match_inputs_from_ingest(target_layers),
            _match_inputs_from_sheet(backbone.layers) if backbone else [],
            _manual_overrides(data.manual_overrides),
        )
        source_layer_by_key = (
            {layer.layer_key: layer for layer in backbone.layers} if backbone else {}
        )
        match_by_target = {match.target_layer_key: match for match in match_result.matches}

        project = Project(
            line_id=data.line_id.strip(),
            process_id=data.process_id.strip(),
            part_id=data.part_id.strip(),
            name=data.name.strip(),
            description=data.description,
            status=ProjectStatus.DRAFT,
        )
        for index, layer_info in enumerate(target_layers, start=1):
            layer = _sheet_layer_from_ingest(layer_info, index)
            match = match_by_target[layer_info.key]
            if match.source_layer_key is None:
                layer.conditions.append(LayerCondition(label="base", condition_index=1))
            else:
                source_layer = source_layer_by_key[match.source_layer_key]
                layer.source_project_id = backbone.id if backbone else None
                layer.source_layer_key = source_layer.layer_key
                _apply_snapshots(_snapshot_conditions(source_layer), layer)
            project.layers.append(layer)

        project = await self.repo.add(project)
        batch_id = uuid.uuid4().hex
        event_type = (
            ChangeEventType.BACKBONE_COPY
            if backbone is not None
            else ChangeEventType.PROJECT_CREATE
        )
        self.repo.session.add(
            ChangeEvent(
                project_id=project.id,
                event_type=event_type,
                actor=actor,
                payload={
                    "batch_id": batch_id,
                    "backbone_project_id": data.backbone_project_id,
                    "auto_count": match_result.auto_count,
                    "manual_count": match_result.manual_count,
                    "unmatched_count": match_result.unmatched_count,
                },
            )
        )
        await self._flush_or_conflict()
        return await self.get_project(project.id)

    async def replace_layer_backbone(
        self, project_id: int, layer_key: str, data: BackboneReplaceIn, actor: str
    ) -> Project:
        project = await self.get_project(project_id)
        source_project = await self.get_project(data.source_project_id)
        target_layer = _find_layer(project.layers, layer_key)
        source_layer = _find_layer(source_project.layers, data.source_layer_key)

        if source_layer.id == target_layer.id:
            raise DomainValidationError("같은 layer를 자기 자신으로 교체할 수 없다")

        # 소스가 같은 프로젝트일 수 있으므로 삭제 전에 값으로 떠 둔다.
        snapshots = _snapshot_conditions(source_layer)
        before = {
            "condition_count": len(target_layer.conditions),
            "cell_count": sum(len(condition.cell_values) for condition in target_layer.conditions),
        }
        for condition in list(target_layer.conditions):
            await self.repo.session.delete(condition)
        await self.repo.session.flush()
        target_layer.conditions.clear()
        target_layer.source_project_id = source_project.id
        target_layer.source_layer_key = source_layer.layer_key
        _apply_snapshots(snapshots, target_layer)
        after = {
            "condition_count": len(snapshots),
            "cell_count": sum(len(snap.cells) for snap in snapshots),
        }
        self.repo.session.add(
            ChangeEvent(
                project_id=project.id,
                event_type=ChangeEventType.BACKBONE_LAYER_REPLACE,
                actor=actor,
                payload={
                    "batch_id": uuid.uuid4().hex,
                    "target_layer_key": layer_key,
                    "source_project_id": source_project.id,
                    "source_layer_key": source_layer.layer_key,
                    "before": before,
                    "after": after,
                },
            )
        )
        await self.repo.session.flush()
        return await self.get_project(project.id)

    async def _flush_or_conflict(self) -> None:
        """flush 중 unique 위반은 409로 변환한다 (동시 생성 레이스 대비)."""
        try:
            await self.repo.session.flush()
        except IntegrityError as exc:
            await self.repo.session.rollback()
            raise ConflictError("이미 존재하는 프로젝트 identity") from exc


def _duplicate_conflict(existing: Project) -> ConflictError:
    # P1-D6: 기존 프로젝트로 유도할 수 있도록 식별자를 실어 보낸다.
    identity = f"{existing.line_id}/{existing.process_id}/{existing.part_id}"
    return ConflictError(
        f"이미 조건표가 있는 process다: {identity}",
        details={
            "existing_project_id": existing.id,
            "existing_status": existing.status.value,
        },
    )


def _validate_overrides(
    overrides: list[ManualOverrideIn],
    target_layers: list[LayerInfo],
    source_layers: list[SheetLayer],
) -> None:
    """수동 매칭이 실존 layer를 가리키는지 검증한다 (조용한 무시 방지)."""
    target_keys = {layer.key for layer in target_layers}
    source_keys = {layer.layer_key for layer in source_layers}
    for override in overrides:
        if override.target_layer_key not in target_keys:
            raise DomainValidationError(
                f"수동 매칭 대상 layer가 없다: {override.target_layer_key}"
            )
        if override.source_layer_key not in source_keys:
            raise DomainValidationError(
                f"수동 매칭 백본 layer가 없다: {override.source_layer_key}"
            )


def _match_inputs_from_ingest(layers: list[LayerInfo]) -> list[LayerMatchInput]:
    return [LayerMatchInput(layer.key, layer.step_seq, layer.layer_id) for layer in layers]


def _match_inputs_from_sheet(layers: list[SheetLayer]) -> list[LayerMatchInput]:
    return [LayerMatchInput(layer.layer_key, layer.step_seq, layer.layer_id) for layer in layers]


def _manual_overrides(overrides: list[ManualOverrideIn]) -> list[ManualOverride]:
    return [ManualOverride(o.target_layer_key, o.source_layer_key) for o in overrides]


def _sheet_layer_from_ingest(layer: LayerInfo, index: int) -> SheetLayer:
    return SheetLayer(
        layer_key=layer.key,
        step_seq=layer.step_seq,
        layer_id=layer.layer_id,
        eqp_type=layer.eqp_type,
        eqp_type_desc=layer.eqp_type_desc,
        area_name=layer.area_name,
        sort_order=index,
    )


def _snapshot_conditions(source_layer: SheetLayer) -> list[_ConditionSnapshot]:
    return [
        _ConditionSnapshot(
            label=condition.label,
            condition_index=condition.condition_index,
            is_por=condition.is_por,
            source_condition_id=condition.id,
            cells=tuple(
                (cell.parameter_code, cell.value_text) for cell in condition.cell_values
            ),
        )
        for condition in source_layer.conditions
    ]


def _apply_snapshots(
    snapshots: list[_ConditionSnapshot], target_layer: SheetLayer
) -> None:
    for snap in snapshots:
        copied = LayerCondition(
            label=snap.label,
            condition_index=snap.condition_index,
            is_por=snap.is_por,
            source_condition_id=snap.source_condition_id,
        )
        copied.cell_values.extend(
            CellValue(parameter_code=code, value_text=value) for code, value in snap.cells
        )
        target_layer.conditions.append(copied)


def _find_layer(layers: list[SheetLayer], layer_key: str) -> SheetLayer:
    for layer in layers:
        if layer.layer_key == layer_key:
            return layer
    raise NotFoundError(f"layer를 찾을 수 없다: {layer_key}")
