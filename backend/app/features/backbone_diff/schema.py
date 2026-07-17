"""Strict public contracts for backbone diff reads."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.features.backbone_diff.cursor import BackboneDiffClassification, BackboneDiffRowStatus

OpaqueTokenText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4096)
]
BasisHashText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]
LayerKeyText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)
]
ParameterCodeText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]
CategoryCodeText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]
DisplayNameText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)
]
ReasonText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)]
ValueText = Annotated[str, StringConstraints(max_length=4096)]
ValueTypeText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)]

BackboneDiffLayerStatus = Literal["available", "unavailable"]
BackboneDiffJumpStatus = Literal["available", "deleted"]
BackboneDiffItemKind = Literal["row", "cell"]


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BackboneDiffRootQueryIn(_StrictModel):
    classification: tuple[BackboneDiffClassification, ...] = Field(default_factory=tuple)
    layer_key: LayerKeyText | None = None
    category_code: CategoryCodeText | None = None
    parameter_code: ParameterCodeText | None = None
    include_unchanged: bool = False
    preview_limit: int = Field(default=20, ge=0, le=20)

    @field_validator("classification", mode="before")
    @classmethod
    def _normalize_classification(cls, value: object) -> tuple[BackboneDiffClassification, ...]:
        if value is None or value == "":
            return ()
        if isinstance(value, str):
            value = [value]
        allowed = {"added", "changed", "cleared", "removed", "unchanged"}
        items = []
        for item in value:  # type: ignore[assignment]
            if not isinstance(item, str):
                raise ValueError("classification values must be strings")
            normalized = item.strip()
            if normalized not in allowed:
                raise ValueError("classification contains an unsupported value")
            items.append(normalized)
        return tuple(sorted(dict.fromkeys(items)))  # type: ignore[return-value]

    @model_validator(mode="after")
    def _validate_include_unchanged(self) -> BackboneDiffRootQueryIn:
        if not self.include_unchanged and "unchanged" in self.classification:
            raise ValueError("include_unchanged must be true when classification includes unchanged")
        return self


class BackboneDiffBranchQueryIn(_StrictModel):
    scope: OpaqueTokenText
    cursor: OpaqueTokenText | None = None
    limit: int = Field(default=50, ge=1, le=100)


class BackboneDiffCellQueryIn(_StrictModel):
    scope: OpaqueTokenText
    cursor: OpaqueTokenText | None = None
    limit: int = Field(default=100, ge=1, le=200)


class BackboneDiffCountsOut(_StrictModel):
    layer_count: int = Field(ge=0)
    available_layer_count: int = Field(ge=0)
    unavailable_layer_count: int = Field(ge=0)
    row_count: int = Field(ge=0)
    cell_count: int = Field(ge=0)
    added_count: int = Field(ge=0)
    changed_count: int = Field(ge=0)
    cleared_count: int = Field(ge=0)
    removed_count: int = Field(ge=0)
    unchanged_count: int = Field(ge=0)


class BackboneDiffRowMetadataOut(_StrictModel):
    label_changed: bool = False
    index_changed: bool = False
    por_changed: bool = False


class BackboneDiffConditionMetadataOut(_StrictModel):
    condition_id: int | None = Field(default=None, ge=1)
    source_condition_id: int | None = Field(default=None, ge=1)
    label: DisplayNameText | None = None
    condition_index: int | None = Field(default=None, ge=0)
    is_por: bool | None = None


class BackboneDiffParameterMetadataOut(_StrictModel):
    parameter_code: ParameterCodeText
    value_type: ValueTypeText
    display_name: DisplayNameText
    category_code: CategoryCodeText | None = None
    sort_order: int = Field(ge=0)
    active: bool


class BackboneDiffLayerSummaryOut(_StrictModel):
    layer_key: LayerKeyText
    layer_sort: int = Field(ge=0)
    layer_status: BackboneDiffLayerStatus = "available"
    baseline_condition_count: int = Field(ge=0)
    current_condition_count: int = Field(ge=0)
    row_count: int = Field(ge=0)
    cell_count: int = Field(ge=0)
    changed_count: int = Field(ge=0)
    branch_scope: OpaqueTokenText | None = None


class BackboneDiffPreviewItemOut(_StrictModel):
    item_kind: BackboneDiffItemKind
    classification: BackboneDiffClassification
    layer_key: LayerKeyText
    effective_condition_index: int = Field(ge=0)
    item_sort_key: list[str | int | None] = Field(default_factory=list)
    status_rank: int = Field(ge=0)
    row_ref: OpaqueTokenText | None = None
    cell_scope: OpaqueTokenText | None = None
    row_status: BackboneDiffRowStatus | None = None
    parameter_code: ParameterCodeText | None = None


class BackboneDiffRootOut(_StrictModel):
    scope: OpaqueTokenText
    basis_hash: BasisHashText
    counts: BackboneDiffCountsOut
    layer_summaries: list[BackboneDiffLayerSummaryOut] = Field(default_factory=list)
    changed_preview: list[BackboneDiffPreviewItemOut] = Field(default_factory=list)


class BackboneDiffConditionItemOut(_StrictModel):
    row_ref: OpaqueTokenText
    row_status: BackboneDiffRowStatus
    effective_condition_index: int = Field(ge=0)
    identity: int = Field(ge=1)
    baseline_condition: BackboneDiffConditionMetadataOut | None = None
    current_condition: BackboneDiffConditionMetadataOut | None = None
    row_metadata: BackboneDiffRowMetadataOut = Field(default_factory=BackboneDiffRowMetadataOut)
    filtered_cell_count: int = Field(ge=0)
    full_cell_count: int = Field(ge=0)
    jump_status: BackboneDiffJumpStatus = "available"
    cell_scope: OpaqueTokenText | None = None


class BackboneDiffConditionPageOut(_StrictModel):
    scope: OpaqueTokenText
    basis_hash: BasisHashText
    items: list[BackboneDiffConditionItemOut] = Field(default_factory=list)
    next_cursor: OpaqueTokenText | None = None


class BackboneDiffCellItemOut(_StrictModel):
    classification: BackboneDiffClassification
    reason: ReasonText
    parameter_code: ParameterCodeText
    parameter_sort: int = Field(ge=0)
    baseline_value: ValueText | None = None
    current_value: ValueText | None = None
    baseline_metadata: BackboneDiffParameterMetadataOut | None = None
    current_metadata: BackboneDiffParameterMetadataOut | None = None
    jump_status: BackboneDiffJumpStatus = "available"


class BackboneDiffCellPageOut(_StrictModel):
    scope: OpaqueTokenText
    basis_hash: BasisHashText
    row_ref: OpaqueTokenText
    items: list[BackboneDiffCellItemOut] = Field(default_factory=list)
    next_cursor: OpaqueTokenText | None = None


__all__ = [
    "BackboneDiffBranchQueryIn",
    "BackboneDiffCellItemOut",
    "BackboneDiffCellPageOut",
    "BackboneDiffCellQueryIn",
    "BackboneDiffConditionItemOut",
    "BackboneDiffConditionMetadataOut",
    "BackboneDiffConditionPageOut",
    "BackboneDiffCountsOut",
    "BackboneDiffJumpStatus",
    "BackboneDiffItemKind",
    "BackboneDiffLayerStatus",
    "BackboneDiffLayerSummaryOut",
    "BackboneDiffParameterMetadataOut",
    "BackboneDiffPreviewItemOut",
    "BackboneDiffRootOut",
    "BackboneDiffRootQueryIn",
    "BackboneDiffRowMetadataOut",
    "BasisHashText",
    "CategoryCodeText",
    "DisplayNameText",
    "LayerKeyText",
    "OpaqueTokenText",
    "ParameterCodeText",
    "ReasonText",
    "ValueText",
    "ValueTypeText",
]
