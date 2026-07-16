"""Strict public JSON contracts for history read surfaces."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

HistoryOrigin = Literal["manual", "paste", "backbone", "system"]
HistoryDetailStatus = Literal["available", "not_applicable", "legacy_unavailable"]
HistoryMetadataStatus = Literal["complete", "legacy_partial"]
HistoryJumpStatus = Literal["available", "deleted"]
HistoryOrderKind = Literal["event_desc", "capture_asc"]

OpaqueTokenText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4096)
]
BatchIdText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
LayerKeyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
ActorText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
SummaryText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)]
ParameterCodeText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]
ChoiceCodeText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]
ChoiceLabelText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HistoryTimelineQueryIn(_StrictModel):
    cursor: OpaqueTokenText | None = None
    limit: int = Field(default=50, ge=1, le=100)


class HistoryDetailQueryIn(_StrictModel):
    scope: OpaqueTokenText
    cursor: OpaqueTokenText | None = None
    limit: int = Field(default=100, ge=1, le=200)


class HistoryCellHistoryQueryIn(_StrictModel):
    condition_id: int = Field(strict=True, ge=1)
    parameter_code: ParameterCodeText
    cursor: OpaqueTokenText | None = None
    limit: int = Field(default=50, ge=1, le=100)


class HistoryCoverageOut(_StrictModel):
    legacy_unresolved_layer_count: int = Field(default=0, ge=0)
    legacy_detail_unavailable_count: int = Field(default=0, ge=0)


class HistoryJumpTargetOut(_StrictModel):
    layer_key: LayerKeyText | None = None
    condition_id: int | None = Field(default=None, ge=1)
    parameter_code: ParameterCodeText | None = None
    cell_ref: str | None = None
    jump_status: HistoryJumpStatus = "available"


class HistoryDetailScopeTokenOut(_StrictModel):
    value: OpaqueTokenText


class HistoryTimelineItemOut(_StrictModel):
    kind: Literal["event", "batch"]
    cursor_id: int = Field(ge=0)
    event_types: list[str] = Field(default_factory=list)
    actors: list[ActorText] = Field(default_factory=list)
    origins: list[HistoryOrigin] = Field(default_factory=list)
    started_at: datetime
    occurred_at: datetime
    layer_keys: list[LayerKeyText] = Field(default_factory=list)
    source_project_id: int | None = Field(default=None, ge=1)
    batch_id: BatchIdText | None = None
    matched_event_count: int = Field(default=0, ge=0)
    total_event_count: int = Field(default=0, ge=0)
    summary: SummaryText
    jump_target: HistoryJumpTargetOut | None = None
    detail_status: HistoryDetailStatus
    detail_scope: OpaqueTokenText | None = None
    metadata_status: HistoryMetadataStatus = "complete"


class HistoryTimelineOut(_StrictModel):
    items: list[HistoryTimelineItemOut] = Field(default_factory=list)
    coverage: HistoryCoverageOut = Field(default_factory=HistoryCoverageOut)
    next_cursor: OpaqueTokenText | None = None


class HistoryDetailCaptureTupleOut(_StrictModel):
    target_layer_sort: int = Field(ge=0)
    target_layer_key: LayerKeyText
    source_condition_index: int = Field(ge=0)
    source_condition_id: int = Field(ge=1)
    parameter_sort: int = Field(ge=0)
    parameter_code: ParameterCodeText
    event_id: int | None = Field(default=None, ge=1)


class HistoryStateEntryOut(_StrictModel):
    code: ChoiceCodeText | None = None
    label: ChoiceLabelText | None = None


class HistoryDetailItemOut(_StrictModel):
    event_id: int = Field(ge=1)
    order_kind: HistoryOrderKind
    old_code: ChoiceCodeText | None = None
    new_code: ChoiceCodeText | None = None
    choice_label: ChoiceLabelText | None = None
    actor: ActorText | None = None
    origin: HistoryOrigin
    created_at: datetime
    layer_key: LayerKeyText | None = None
    jump_target: HistoryJumpTargetOut | None = None
    capture_tuple: HistoryDetailCaptureTupleOut | None = None
    metadata_status: HistoryMetadataStatus = "complete"


class HistoryDetailOut(_StrictModel):
    order_kind: HistoryOrderKind
    detail_status: HistoryDetailStatus
    items: list[HistoryDetailItemOut] = Field(default_factory=list)
    reason: SummaryText | None = None
    next_cursor: OpaqueTokenText | None = None


class HistoryCellHistoryItemOut(_StrictModel):
    event_id: int = Field(ge=1)
    old_code: ChoiceCodeText | None = None
    new_code: ChoiceCodeText | None = None
    choice_label: ChoiceLabelText | None = None
    actor: ActorText | None = None
    origin: HistoryOrigin
    created_at: datetime
    layer_key: LayerKeyText | None = None
    jump_status: HistoryJumpStatus = "available"
    baseline_entry: HistoryStateEntryOut | None = None
    initial_entry: HistoryStateEntryOut | None = None
    initial_state_unavailable: bool = False
    metadata_status: HistoryMetadataStatus = "complete"


class HistoryCellHistoryOut(_StrictModel):
    items: list[HistoryCellHistoryItemOut] = Field(default_factory=list)
    next_cursor: OpaqueTokenText | None = None


__all__ = [
    "ActorText",
    "BatchIdText",
    "ChoiceCodeText",
    "ChoiceLabelText",
    "HistoryCellHistoryItemOut",
    "HistoryCellHistoryOut",
    "HistoryCellHistoryQueryIn",
    "HistoryCoverageOut",
    "HistoryDetailCaptureTupleOut",
    "HistoryDetailItemOut",
    "HistoryDetailOut",
    "HistoryDetailQueryIn",
    "HistoryDetailScopeTokenOut",
    "HistoryDetailStatus",
    "HistoryJumpStatus",
    "HistoryJumpTargetOut",
    "HistoryMetadataStatus",
    "HistoryOrderKind",
    "HistoryOrigin",
    "HistoryStateEntryOut",
    "HistoryTimelineItemOut",
    "HistoryTimelineOut",
    "HistoryTimelineQueryIn",
    "LayerKeyText",
    "OpaqueTokenText",
    "ParameterCodeText",
    "SummaryText",
]
