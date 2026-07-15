"""프로젝트/백본 API 스키마."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ManualOverrideIn(BaseModel):
    target_layer_key: str
    source_layer_key: str


class BackboneReplaceIn(BaseModel):
    source_project_id: int
    source_layer_key: str


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line_id: str
    process_id: str
    part_id: str
    name: str
    device_type_code: str
    project_category_code: str
    comment: str | None = None
    backbone_project_id: int | None = None
    manual_overrides: list[ManualOverrideIn] = Field(default_factory=list)


class ProjectProfilePatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_name: str | None = None
    device_type_code: str | None = None
    project_category_code: str | None = None
    comment: str | None = None
    active_direction_code: str | None = None
    gate_direction_code: str | None = None
    gross_die: str | None = None
    pitch_x: str | None = None
    pitch_y: str | None = None
    shot_x: str | None = None
    shot_y: str | None = None
    slit_occupancy: str | None = None
    lens_occupancy: str | None = None
    map_offset_x: str | None = None
    map_offset_y: str | None = None
    scribe_lane_x: str | None = None
    scribe_lane_y: str | None = None
    shot_count: str | None = None
    full_shot: str | None = None
    layer_total: str | None = None
    euv: str | None = None
    imm: str | None = None
    arf: str | None = None
    krf: str | None = None
    iline: str | None = None
    soh: str | None = None
    pspi: str | None = None
    metal_layer_count: str | None = None


class ChoiceValueOut(BaseModel):
    code: str
    label: str
    is_active: bool


class ProjectProfileOut(BaseModel):
    project_id: int
    process_name: str
    device_type: ChoiceValueOut
    project_category: ChoiceValueOut
    comment: str | None
    active_direction: ChoiceValueOut | None
    gate_direction: ChoiceValueOut | None
    gross_die: str | None
    pitch_x: str | None
    pitch_y: str | None
    shot_x: str | None
    shot_y: str | None
    slit_occupancy: str | None
    lens_occupancy: str | None
    map_offset_x: str | None
    map_offset_y: str | None
    scribe_lane_x: str | None
    scribe_lane_y: str | None
    shot_count: str | None
    full_shot: str | None
    layer_total: str | None
    euv: str | None
    imm: str | None
    arf: str | None
    krf: str | None
    iline: str | None
    soh: str | None
    pspi: str | None
    metal_layer_count: str | None
    created_at: datetime
    updated_at: datetime


class LayerOut(BaseModel):
    id: int
    layer_key: str
    step_seq: str
    layer_id: str
    eqp_type: str | None
    eqp_type_desc: str | None
    area_name: str | None
    sort_order: int
    condition_count: int
    cell_count: int
    source_project_id: int | None
    source_layer_key: str | None


class ProjectOut(BaseModel):
    id: int
    line_id: str
    process_id: str
    part_id: str
    name: str
    status: str
    profile: ProjectProfileOut
    layers: list[LayerOut] = Field(default_factory=list)


class ProjectSummaryOut(BaseModel):
    """목록용 요약 — layer/cell 집계만 담고 전체 트리는 싣지 않는다."""

    id: int
    line_id: str
    process_id: str
    part_id: str
    name: str
    status: str
    device_type: ChoiceValueOut
    project_category: ChoiceValueOut
    layer_total: str | None
    updated_at: datetime
    layer_count: int
    cell_count: int


class ProjectListOut(BaseModel):
    items: list[ProjectSummaryOut]
    next_cursor: int | None = None


class BackboneCandidateOut(BaseModel):
    """백본 후보 프로젝트 + 대상 구조에 대한 자동 매칭률."""

    id: int
    name: str
    line_id: str
    process_id: str
    part_id: str
    status: str
    layer_count: int
    match_rate: float
    matched_count: int
    unmatched_count: int


class MatchPreviewIn(BaseModel):
    line_id: str
    process_id: str
    backbone_project_id: int | None = None
    manual_overrides: list[ManualOverrideIn] = Field(default_factory=list)


class MatchOut(BaseModel):
    target_layer_key: str
    source_layer_key: str | None
    match_type: str


class MatchPreviewOut(BaseModel):
    match_rate: float
    matched_count: int
    unmatched_count: int
    copy_condition_count: int
    copy_cell_count: int
    matches: list[MatchOut]
