from typing import Any

from pydantic import BaseModel


# --- Backbone Replacement ---

class BackboneReplaceRequest(BaseModel):
    source_condition_id: int
    source_layer_name: str | None = None  # Auto-match by name; None = use same layer_name
    changed_by: int


class BackboneReplaceResponse(BaseModel):
    project_layer_id: int
    backbone_condition_id: int
    backbone_condition_name: str
    changed_columns: int
    conditions: dict[str, Any]
    backbone_conditions: dict[str, Any]


# --- Layer Add/Delete ---

class LayerAddRequest(BaseModel):
    layer_id: str
    source_condition_id: int | None = None  # If provided, copy conditions from this approved condition
    source_layer_name: str | None = None  # If source_condition_id set, which layer to copy
    changed_by: int


class LayerAddResponse(BaseModel):
    project_layer_id: int
    layer_id: str
    layer_name: str
    backbone_condition_id: int | None = None
    backbone_condition_name: str | None = None
    conditions: dict[str, Any]
    sort_order: int
