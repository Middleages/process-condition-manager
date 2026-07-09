"""프로젝트 생성/백본 서비스."""

from dataclasses import asdict

from app.core.errors import ConflictError, NotFoundError
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
        if await self.repo.get_by_identity(data.line_id, data.process_id, data.part_id):
            raise ConflictError(
                f"이미 존재하는 프로젝트 identity: {data.line_id}/{data.process_id}/{data.part_id}"
            )
        target_layers = await self.reader.get_layers(data.line_id, data.process_id)
        backbone = (
            await self.get_project(data.backbone_project_id)
            if data.backbone_project_id is not None
            else None
        )
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
                layer.conditions.append(LayerCondition(label="기본", condition_index=1))
            else:
                source_layer = source_layer_by_key[match.source_layer_key]
                layer.source_project_id = backbone.id if backbone else None
                layer.source_layer_key = source_layer.layer_key
                _copy_conditions(source_layer, layer)
            project.layers.append(layer)

        project = await self.repo.add(project)
        project_event = ChangeEvent(
            project_id=project.id,
            event_type=ChangeEventType.BACKBONE_COPY,
            actor=actor,
            payload={
                "backbone_project_id": data.backbone_project_id,
                "matched_count": match_result.matched_count,
                "unmatched_count": match_result.unmatched_count,
            },
        )
        self.repo.session.add(project_event)
        await self.repo.session.flush()
        return await self.get_project(project.id)


    async def replace_layer_backbone(
        self, project_id: int, layer_key: str, data: BackboneReplaceIn, actor: str
    ) -> Project:
        project = await self.get_project(project_id)
        source_project = await self.get_project(data.source_project_id)
        target_layer = _find_layer(project.layers, layer_key)
        source_layer = _find_layer(source_project.layers, data.source_layer_key)

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
        _copy_conditions(source_layer, target_layer)
        after = {
            "condition_count": len(source_layer.conditions),
            "cell_count": sum(len(condition.cell_values) for condition in source_layer.conditions),
        }
        self.repo.session.add(
            ChangeEvent(
                project_id=project.id,
                event_type=ChangeEventType.BACKBONE_LAYER_REPLACE,
                actor=actor,
                payload={
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


def _copy_conditions(source_layer: SheetLayer, target_layer: SheetLayer) -> None:
    for condition in source_layer.conditions:
        copied = LayerCondition(
            label=condition.label,
            condition_index=condition.condition_index,
            is_por=condition.is_por,
            source_condition_id=condition.id,
        )
        copied.cell_values.extend(
            CellValue(parameter_code=cell.parameter_code, value_text=cell.value_text)
            for cell in condition.cell_values
        )
        target_layer.conditions.append(copied)


def _find_layer(layers: list[SheetLayer], layer_key: str) -> SheetLayer:
    for layer in layers:
        if layer.layer_key == layer_key:
            return layer
    raise NotFoundError(f"layer를 찾을 수 없다: {layer_key}")
