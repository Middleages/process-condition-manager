"""프로젝트/백본 API 스키마."""

from pydantic import BaseModel, Field


class ManualOverrideIn(BaseModel):
    target_layer_key: str
    source_layer_key: str


class BackboneReplaceIn(BaseModel):
    source_project_id: int
    source_layer_key: str


class ProjectCreate(BaseModel):
    line_id: str
    process_id: str
    part_id: str
    name: str
    description: str | None = None
    backbone_project_id: int | None = None
    manual_overrides: list[ManualOverrideIn] = Field(default_factory=list)


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
    description: str | None
    status: str
    layers: list[LayerOut] = Field(default_factory=list)


class ProjectSummaryOut(BaseModel):
    """목록용 요약 — layer/cell 집계만 담고 전체 트리는 싣지 않는다."""

    id: int
    line_id: str
    process_id: str
    part_id: str
    name: str
    description: str | None
    status: str
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
