"""프로젝트 생성/백본 서비스."""

import uuid
from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, DomainValidationError, NotFoundError
from app.core.locks import utcnow
from app.domain.backbone import LayerMatchInput, ManualOverride, MatchResult, match_layers
from app.domain.choices.rules import ResolvedChoice, normalize_choice_code
from app.domain.decimal_values import normalize_optional_decimal
from app.features.choice_sets.repository import ChoiceSetRepository
from app.features.projects.repository import ProjectRepository, ProjectSummary
from app.features.projects.schema import (
    BackboneReplaceIn,
    ChoiceValueOut,
    ManualOverrideIn,
    MatchOut,
    MatchPreviewIn,
    MatchPreviewOut,
    ProjectCreate,
    ProjectProfileOut,
    ProjectProfilePatchIn,
)
from app.ingest.reader import IngestReader, LayerInfo
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    Project,
    ProjectProfile,
    ProjectStatus,
    SheetLayer,
)
from app.project_metadata import ProjectMetadataProvider, ProjectProfileSeed

_CHOICE_FIELDS = {
    "device_type_code": "device_type",
    "project_category_code": "project_category",
    "active_direction_code": "active_direction",
    "gate_direction_code": "gate_direction",
}
_PROFILE_CHOICE_SET_CODES = frozenset(_CHOICE_FIELDS.values())
_REQUIRED_CHOICE_FIELDS = frozenset({"device_type_code", "project_category_code"})
_DECIMAL_FIELDS = frozenset(
    {
        "pitch_x",
        "pitch_y",
        "shot_x",
        "shot_y",
        "slit_occupancy",
        "lens_occupancy",
        "map_offset_x",
        "map_offset_y",
        "scribe_lane_x",
        "scribe_lane_y",
    }
)
_PATCH_FIELD_ORDER = (
    "process_name",
    "device_type_code",
    "project_category_code",
    "comment",
    "active_direction_code",
    "gate_direction_code",
    "gross_die",
    "pitch_x",
    "pitch_y",
    "shot_x",
    "shot_y",
    "slit_occupancy",
    "lens_occupancy",
    "map_offset_x",
    "map_offset_y",
    "scribe_lane_x",
    "scribe_lane_y",
    "shot_count",
    "full_shot",
    "layer_total",
    "euv",
    "imm",
    "arf",
    "krf",
    "iline",
    "soh",
    "pspi",
    "metal_layer_count",
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

    def __init__(
        self,
        repo: ProjectRepository,
        reader: IngestReader,
        metadata_provider: ProjectMetadataProvider,
    ) -> None:
        self.repo = repo
        self.reader = reader
        self.metadata_provider = metadata_provider
        self.choice_repo = ChoiceSetRepository(repo.session)

    async def list_projects(
        self,
        *,
        query: str | None = None,
        status: str | None = None,
        device_type_code: str | None = None,
        project_category_code: str | None = None,
        cursor: int | None = None,
        limit: int = 50,
    ) -> tuple[list[ProjectSummary], int | None]:
        return await self.repo.list_summaries(
            query=query,
            status=status,
            device_type_code=device_type_code,
            project_category_code=project_category_code,
            cursor=cursor,
            limit=limit,
        )

    async def get_project(self, project_id: int) -> Project:
        project = await self.repo.get(project_id)
        if project is None:
            raise NotFoundError(f"프로젝트를 찾을 수 없다: {project_id}")
        return project

    async def list_backbone_candidates(
        self, line_id: str, process_id: str
    ) -> list[tuple[Project, MatchResult]]:
        """대상 process 구조에 대해 후보 프로젝트별 자동 매칭률을 계산한다.

        매칭률 내림차순 정렬(동률이면 최근 생성 우선). Phase 1은 draft만 존재하지만
        status 우선순위 자리는 잡아둔다(Approved 우선 — Phase 5).
        """
        target_layers = await self.reader.get_layers(line_id, process_id)
        target_inputs = _match_inputs_from_ingest(target_layers)
        candidates = await self.repo.list_backbone_candidates()
        ranked = [
            (candidate, match_layers(target_inputs, _match_inputs_from_sheet(candidate.layers)))
            for candidate in candidates
        ]
        ranked.sort(
            key=lambda pair: (_status_priority(pair[0].status), pair[1].match_rate, pair[0].id),
            reverse=True,
        )
        return ranked

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
        line_id = _normalize_required_text(data.line_id, "LINE", max_length=64)
        process_id = _normalize_required_text(
            data.process_id, "Process", max_length=128
        )
        part_id = _normalize_required_text(data.part_id, "PARTID", max_length=128)
        name = _normalize_required_text(data.name, "프로젝트 이름", max_length=256)

        existing = await self.repo.get_by_identity(line_id, process_id, part_id)
        if existing is not None:
            raise _duplicate_conflict(existing)

        process = await self.reader.get_process(line_id, process_id)
        device_type_code = normalize_choice_code(data.device_type_code, 128)
        project_category_code = normalize_choice_code(data.project_category_code, 128)
        seed = await self.metadata_provider.load_seed(
            line_id=line_id,
            process_id=process_id,
            part_id=part_id,
        )
        raw_seed = asdict(seed)
        final_values = normalize_profile_seed(seed)
        final_values["device_type_code"] = device_type_code
        final_values["project_category_code"] = project_category_code
        if "comment" in data.model_fields_set:
            final_values["comment"] = normalize_optional_text(data.comment)

        process_name = _normalize_required_text(process.display_name, "Process 이름")
        target_layers = await self.reader.get_layers(line_id, process_id)
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

        choice_keys = {
            (set_code, value)
            for field, set_code in _CHOICE_FIELDS.items()
            if (value := final_values[field]) is not None
        }
        locked_sets = await self.choice_repo.lock_sets_for_write(
            _PROFILE_CHOICE_SET_CODES
        )
        await self.choice_repo.resolve_active_options(
            choice_keys,
            for_write=True,
            prelocked_set_codes=locked_sets,
        )

        project = Project(
            line_id=line_id,
            process_id=process_id,
            part_id=part_id,
            name=name,
            status=ProjectStatus.DRAFT,
            profile=ProjectProfile(process_name=process_name, **final_values),
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

        batch_id = uuid.uuid4().hex
        profile_final = {"process_name": process_name, **final_values}
        project.events.append(
            ChangeEvent(
                event_type=ChangeEventType.PROJECT_CREATE,
                actor=actor,
                payload={
                    "batch_id": batch_id,
                    "identity": {
                        "line_id": line_id,
                        "process_id": process_id,
                        "part_id": part_id,
                        "name": name,
                    },
                    "metadata_provider": self.metadata_provider.identifier,
                    "backbone_project_id": data.backbone_project_id,
                    "profile_seed": raw_seed,
                    "profile_final": profile_final,
                },
            )
        )
        if backbone is not None:
            project.events.append(
                ChangeEvent(
                    event_type=ChangeEventType.BACKBONE_COPY,
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

        self.repo.add(project)
        await self._flush_or_conflict()
        return await self.get_project(project.id)

    async def get_profile_out(self, project_id: int) -> ProjectProfileOut:
        row = await self.repo.get_profile(project_id)
        if row is None:
            raise NotFoundError(f"프로젝트 Profile을 찾을 수 없다: {project_id}")
        return await self.profile_out(row[1])

    async def profile_out(self, profile: ProjectProfile) -> ProjectProfileOut:
        resolved = await self._resolve_profile_choices(profile)
        return _profile_out(profile, resolved)

    async def patch_profile(
        self, project_id: int, data: ProjectProfilePatchIn, *, actor: str
    ) -> ProjectProfileOut:
        row = await self.repo.get_profile(project_id)
        if row is None:
            raise NotFoundError(f"프로젝트 Profile을 찾을 수 없다: {project_id}")
        project, profile = row

        supplied = data.model_fields_set
        candidates: dict[str, str | None] = {}
        for field in _PATCH_FIELD_ORDER:
            if field not in supplied:
                continue
            value = getattr(data, field)
            if field == "process_name":
                candidates[field] = _normalize_required_text(value, "Process 이름")
            elif field in _CHOICE_FIELDS:
                if field in _REQUIRED_CHOICE_FIELDS:
                    candidates[field] = _normalize_required_choice(value, field)
                else:
                    candidates[field] = _normalize_optional_choice(value)
            elif field in _DECIMAL_FIELDS:
                candidates[field] = normalize_optional_decimal(value)
            else:
                candidates[field] = normalize_optional_text(value)

        choice_keys: set[tuple[str, str]] = set()
        for field in _CHOICE_FIELDS:
            if field not in candidates:
                continue
            set_code = _CHOICE_FIELDS[field]
            current = getattr(profile, field)
            incoming = candidates[field]
            if current is not None:
                choice_keys.add((set_code, current))
            if incoming is not None:
                choice_keys.add((set_code, incoming))
        resolved = await self.choice_repo.resolve_options(
            choice_keys,
            include_inactive=True,
            for_write=True,
        )
        self._validate_patch_choices(profile, candidates, resolved)

        changes: dict[str, dict[str, Any]] = {}
        for field in _PATCH_FIELD_ORDER:
            if field not in candidates:
                continue
            old = getattr(profile, field)
            new = candidates[field]
            if old == new:
                continue
            if field in _CHOICE_FIELDS:
                set_code = _CHOICE_FIELDS[field]
                changes[field] = {
                    "old": _choice_event_value(resolved, set_code, old),
                    "new": _choice_event_value(resolved, set_code, new),
                }
            else:
                changes[field] = {"old": old, "new": new}

        if not changes:
            return await self.profile_out(profile)

        for field in changes:
            setattr(profile, field, candidates[field])
        now = utcnow()
        profile.updated_at = now
        project.updated_at = now
        self.repo.session.add(
            ChangeEvent(
                project=project,
                event_type=ChangeEventType.PROJECT_PROFILE_UPDATE,
                actor=actor,
                payload={"changes": changes},
            )
        )
        await self.repo.session.flush()
        return await self.profile_out(profile)

    def _validate_patch_choices(
        self,
        profile: ProjectProfile,
        candidates: dict[str, str | None],
        resolved: dict[tuple[str, str], ResolvedChoice],
    ) -> None:
        for field, set_code in _CHOICE_FIELDS.items():
            if field not in candidates:
                continue
            old = getattr(profile, field)
            new = candidates[field]
            if new is None:
                if old is not None and (set_code, old) not in resolved:
                    raise DomainValidationError(
                        f"저장된 선택지를 해석할 수 없다: {set_code}/{old}"
                    )
                continue
            choice = resolved.get((set_code, new))
            is_known_inactive_noop = new == old and choice is not None
            is_active_new_value = (
                new != old and choice is not None and choice.effective_is_active
            )
            if not is_known_inactive_noop and not is_active_new_value:
                raise DomainValidationError(
                    f"활성 선택지가 아니다: {set_code}/{new}"
                )

    async def _resolve_profile_choices(
        self, profile: ProjectProfile
    ) -> dict[tuple[str, str], ResolvedChoice]:
        keys = {
            (set_code, value)
            for field, set_code in _CHOICE_FIELDS.items()
            if (value := getattr(profile, field)) is not None
        }
        resolved = await self.choice_repo.resolve_options(
            keys, include_inactive=True, for_write=False
        )
        missing = sorted(keys - set(resolved))
        if missing:
            identities = ", ".join(f"{set_code}/{code}" for set_code, code in missing)
            raise DomainValidationError(f"Project Profile 선택지를 해석할 수 없다: {identities}")
        return resolved

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


def normalize_optional_text(raw: str | None) -> str | None:
    if raw is None:
        return None
    value = raw.strip()
    return value or None


def normalize_profile_seed(seed: ProjectProfileSeed) -> dict[str, str | None]:
    """Normalize every provider field before any aggregate row is attached."""
    normalized: dict[str, str | None] = {}
    for field, value in asdict(seed).items():
        if field in _CHOICE_FIELDS:
            normalized[field] = _normalize_optional_choice(value)
        elif field in _DECIMAL_FIELDS:
            normalized[field] = normalize_optional_decimal(value)
        else:
            normalized[field] = normalize_optional_text(value)
    return normalized


def _normalize_required_text(
    raw: str | None, field_name: str, *, max_length: int | None = None
) -> str:
    if raw is None:
        raise DomainValidationError(f"{field_name}은(는) 비어 있을 수 없다")
    value = raw.strip()
    if not value:
        raise DomainValidationError(f"{field_name}은(는) 비어 있을 수 없다")
    if max_length is not None and len(value) > max_length:
        raise DomainValidationError(
            f"{field_name}은(는) {max_length}자 이하여야 한다"
        )
    return value


def _normalize_required_choice(raw: str | None, field_name: str) -> str:
    if raw is None or not raw.strip():
        raise DomainValidationError(f"{field_name}은(는) 비어 있을 수 없다")
    return normalize_choice_code(raw, 128)


def _normalize_optional_choice(raw: str | None) -> str | None:
    if raw is None or not raw.strip():
        return None
    return normalize_choice_code(raw, 128)


def _choice_out(choice: ResolvedChoice) -> ChoiceValueOut:
    return ChoiceValueOut(
        code=choice.option_code,
        label=choice.label,
        is_active=choice.effective_is_active,
    )


def _optional_choice_out(
    resolved: dict[tuple[str, str], ResolvedChoice],
    set_code: str,
    code: str | None,
) -> ChoiceValueOut | None:
    if code is None:
        return None
    return _choice_out(resolved[(set_code, code)])


def _choice_event_value(
    resolved: dict[tuple[str, str], ResolvedChoice],
    set_code: str,
    code: str | None,
) -> dict[str, str] | None:
    if code is None:
        return None
    choice = resolved.get((set_code, code))
    if choice is None:
        raise DomainValidationError(
            f"Project Profile 선택지를 해석할 수 없다: {set_code}/{code}"
        )
    return {"code": code, "label": choice.label}


def _profile_out(
    profile: ProjectProfile,
    resolved: dict[tuple[str, str], ResolvedChoice],
) -> ProjectProfileOut:
    return ProjectProfileOut(
        project_id=profile.project_id,
        process_name=profile.process_name,
        device_type=_choice_out(
            resolved[("device_type", profile.device_type_code)]
        ),
        project_category=_choice_out(
            resolved[("project_category", profile.project_category_code)]
        ),
        comment=profile.comment,
        active_direction=_optional_choice_out(
            resolved, "active_direction", profile.active_direction_code
        ),
        gate_direction=_optional_choice_out(
            resolved, "gate_direction", profile.gate_direction_code
        ),
        gross_die=profile.gross_die,
        pitch_x=profile.pitch_x,
        pitch_y=profile.pitch_y,
        shot_x=profile.shot_x,
        shot_y=profile.shot_y,
        slit_occupancy=profile.slit_occupancy,
        lens_occupancy=profile.lens_occupancy,
        map_offset_x=profile.map_offset_x,
        map_offset_y=profile.map_offset_y,
        scribe_lane_x=profile.scribe_lane_x,
        scribe_lane_y=profile.scribe_lane_y,
        shot_count=profile.shot_count,
        full_shot=profile.full_shot,
        layer_total=profile.layer_total,
        euv=profile.euv,
        imm=profile.imm,
        arf=profile.arf,
        krf=profile.krf,
        iline=profile.iline,
        soh=profile.soh,
        pspi=profile.pspi,
        metal_layer_count=profile.metal_layer_count,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


def _status_priority(status: ProjectStatus) -> int:
    """백본 후보 정렬 우선순위 (Approved 우선 자리 확보 — Phase 5 상태 머신 대비)."""
    order = {ProjectStatus.DRAFT: 0}
    return order.get(status, 0)


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
