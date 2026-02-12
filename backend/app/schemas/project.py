from datetime import datetime
from pydantic import BaseModel
from typing import Any


# --- Request schemas ---

class ProjectCreateRequest(BaseModel):
    product_id: int
    backbone_product_id: int
    created_by: int


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
    layer_id: int
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
    product_id: int
    product_name: str
    main_backbone_id: int
    backbone_name: str
    status: str
    created_by: int
    creator_name: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectDetailResponse(ProjectResponse):
    layers: list[ProjectLayerResponse] = []


class ValidationErrorItem(BaseModel):
    layer_id: int
    layer_name: str
    column_name: str
    display_name: str
    rule_type: str
    message: str


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
    items: list[ChangeLogResponse]


class BulkSaveResponse(BaseModel):
    success: bool
    updated_layers: int
    change_log_count: int
    updated_at: datetime
