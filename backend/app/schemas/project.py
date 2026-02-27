from datetime import datetime
from pydantic import BaseModel
from typing import Any


# --- Request schemas ---

class ProjectCreateRequest(BaseModel):
    """V1 backward-compatible: product_id + backbone_product_id based creation."""
    product_id: int
    backbone_product_id: int
    created_by: int


class ProjectCreateRequestV2(BaseModel):
    """V2 device-ref based project creation request (SPEC-PROJECT-002)."""
    line_id: int
    product_name: str
    process: str
    part_id: str
    device_type: str = "full"  # "full" | "short"
    selected_layer_ids: list[str] | None = None  # layer_master.layer_id values, required when device_type="short"
    backbone_product_id: int | None = None  # None = "no backbone"


class LayerConditions(BaseModel):
    project_layer_id: int
    conditions: dict[str, Any]


class BulkSaveRequest(BaseModel):
    layers: list[LayerConditions]
    updated_by: int
    expected_updated_at: datetime


# --- Response schemas ---

class ProjectLayerResponse(BaseModel):
    id: int
    layer_id: str
    layer_name: str
    step_seq: str
    layer_number: str
    backbone_product_id: int | None = None
    backbone_product_name: str | None = None
    conditions: dict[str, Any]
    backbone_conditions: dict[str, Any]
    sort_order: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectResponse(BaseModel):
    id: int
    product_id: int | None = None
    product_name: str
    line_id: int | None = None
    line_name: str | None = None
    main_backbone_id: int | None = None
    backbone_name: str | None = None
    status: str
    revision: int = 1
    parent_project_id: int | None = None
    is_latest: bool = True
    created_by: int
    creator_name: str
    layer_count: int = 0
    created_at: datetime
    updated_at: datetime
    # SPEC-PROJECT-002 V2 fields
    device_master_id: int | None = None
    process: str | None = None
    device_type: str = "full"
    header_metadata: dict | None = None
    part_id: str | None = None

    model_config = {"from_attributes": True}


class ProjectDetailResponse(ProjectResponse):
    layers: list[ProjectLayerResponse] = []


class ValidationErrorItem(BaseModel):
    layer_id: str
    layer_name: str
    column_name: str
    display_name: str
    rule_type: str
    message: str
    metadata: dict | None = None


class ValidationResponse(BaseModel):
    project_id: int
    is_valid: bool
    error_count: int
    errors: list[ValidationErrorItem]


class ChangeLogEntry(BaseModel):
    column_name: str
    old_value: str | None
    new_value: str | None


class ChangeLogResponse(BaseModel):
    id: int
    project_layer_id: int
    layer_name: str
    column_name: str
    old_value: str | None
    new_value: str | None
    change_type: str
    changed_by: int
    changed_by_name: str
    changed_at: datetime

    model_config = {"from_attributes": True}


class ChangeLogListResponse(BaseModel):
    total: int
    page: int = 1
    items: list[ChangeLogResponse]


# --- Timeline schemas ---

class TimelineEntryDetails(BaseModel):
    # For cell_change
    layer_name: str | None = None
    column_name: str | None = None
    old_value: str | None = None
    new_value: str | None = None
    change_type: str | None = None
    # For status_change
    from_status: str | None = None
    to_status: str | None = None
    comment: str | None = None


class TimelineEntry(BaseModel):
    id: str  # "change-500" or "status-5"
    entry_type: str  # "cell_change" or "status_change"
    timestamp: datetime
    user_id: int
    user_name: str
    details: TimelineEntryDetails


class TimelineGroup(BaseModel):
    date: str  # "YYYY-MM-DD"
    entries: list[TimelineEntry]


class TimelineResponse(BaseModel):
    total: int
    page: int
    limit: int
    groups: list[TimelineGroup]


# --- Cell History schemas ---

class CellHistoryItem(BaseModel):
    id: int
    old_value: str | None
    new_value: str | None
    change_type: str
    changed_by: int
    changed_by_name: str
    changed_at: datetime


class CellHistoryResponse(BaseModel):
    project_layer_id: int
    layer_name: str
    column_name: str
    total: int
    items: list[CellHistoryItem]


# --- Version History schemas ---

class VersionItem(BaseModel):
    project_id: int
    revision: int
    status: str
    is_latest: bool
    is_current: bool
    created_by_name: str | None
    created_at: datetime
    revision_reason: str | None = None


class VersionHistoryResponse(BaseModel):
    product_id: int
    product_name: str
    current_project_id: int
    versions: list[VersionItem]


class BulkSaveResponse(BaseModel):
    success: bool
    updated_layers: int
    change_log_count: int
    updated_at: datetime


# --- Revision schemas ---

class ReviseProjectRequest(BaseModel):
    revision_reason: str | None = None


class RevisionItem(BaseModel):
    id: int
    revision: int
    status: str
    revision_reason: str | None
    created_by: str | None
    created_at: datetime
    is_latest: bool

    model_config = {"from_attributes": True}


class RevisionListResponse(BaseModel):
    product_id: int
    product_name: str
    revisions: list[RevisionItem]


# --- Status transition schemas ---

class StatusTransitionRequest(BaseModel):
    new_status: str
    comment: str | None = None


class StatusTransitionResponse(BaseModel):
    id: int
    status: str
    previous_status: str
    changed_by: int
    changed_at: datetime


class ChangeSummaryResponse(BaseModel):
    validation_error_count: int
    changed_layers_count: int
    total_layers_count: int
    changed_cells_count: int
    backbone_replacements_count: int
    recipe_applications_count: int


class StatusHistoryItem(BaseModel):
    id: int
    from_status: str | None
    to_status: str
    changed_by: int
    changer_name: str
    comment: str | None
    changed_at: datetime


class StatusHistoryResponse(BaseModel):
    history: list[StatusHistoryItem]


# --- Version Diff schemas ---

class CellDiff(BaseModel):
    column_name: str
    old_value: str | None
    new_value: str | None


class LayerDiff(BaseModel):
    layer_id: str
    layer_name: str
    change_type: str  # "modified" | "added" | "removed"
    changes: list[CellDiff]


class DiffSummary(BaseModel):
    total_layers_changed: int
    total_cells_changed: int


class VersionDiffResponse(BaseModel):
    base_project_id: int
    compare_project_id: int
    base_revision: int
    compare_revision: int
    summary: DiffSummary
    layers: list[LayerDiff]
