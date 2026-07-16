# pyright: reportMissingImports=false
"""Strict public JSON contracts for history read surfaces."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.models.project import ChangeEventType

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
    created_from: datetime | None = None
    created_to: datetime | None = None
    layer_key: LayerKeyText | None = None
    event_type: list[ChangeEventType] = Field(default_factory=list)
    actor: ActorText | None = None
    origin: list[HistoryOrigin] = Field(default_factory=list)
    source_project_id: int | None = Field(default=None, ge=1)

    @field_validator("created_from", "created_to", mode="before")
    @classmethod
    def _normalize_query_datetime(cls, value: object) -> object:
        if value is None or isinstance(value, datetime):
            return value
        if isinstance(value, str):
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
            return parsed.astimezone(UTC) if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)
        raise ValueError("datetime filters must be ISO datetime strings")

    @field_validator("event_type", mode="before")
    @classmethod
    def _normalize_event_type(cls, value: object) -> list[ChangeEventType]:
        if value is None:
            return []
        if isinstance(value, (str, ChangeEventType)):
            return [ChangeEventType(value)]
        return [ChangeEventType(item) for item in value]  # type: ignore[arg-type]

    @field_validator("origin", mode="before")
    @classmethod
    def _normalize_origin(cls, value: object) -> list[HistoryOrigin]:
        if value is None:
            return []
        if isinstance(value, str):
            return [value]  # type: ignore[list-item]
        return list(value)  # type: ignore[arg-type]

    @model_validator(mode="after")
    def _validate_time_range(self) -> "HistoryTimelineQueryIn":
        if (
            self.created_from is not None
            and self.created_to is not None
            and self.created_from >= self.created_to
        ):
            raise ValueError("created_from must be earlier than created_to")
        return self


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
    event_types: list[ChangeEventType] = Field(default_factory=list)
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


class HistoryDomainCoordinateOut(_StrictModel):
    layer_key: LayerKeyText
    condition_id: int | None = Field(default=None, ge=1)
    parameter_code: ParameterCodeText | None = None
    cell_ref: str | None = None


class HistoryDetailCaptureTupleOut(_StrictModel):
    target_layer_sort: int = Field(ge=0)
    target_layer_key: LayerKeyText
    source_condition_index: int = Field(ge=0)
    source_condition_id: int = Field(ge=1)
    parameter_sort: int = Field(ge=0)
    parameter_code: ParameterCodeText
    event_id: int | None = Field(default=None, ge=1)
    domain_coordinate: HistoryDomainCoordinateOut | None = None
    copied_baseline_value: ChoiceCodeText | None = None


class HistoryStateEntryOut(_StrictModel):
    code: ChoiceCodeText | None = None
    label: ChoiceLabelText | None = None


class HistoryDetailItemOut(_StrictModel):
    event_id: int = Field(ge=1)
    order_kind: HistoryOrderKind
    old_code: ChoiceCodeText | None = None
    new_code: ChoiceCodeText | None = None
    baseline_value: ChoiceCodeText | None = None
    choice_label: ChoiceLabelText | None = None
    actor: ActorText | None = None
    origin: HistoryOrigin
    created_at: datetime
    layer_key: LayerKeyText | None = None
    jump_target: HistoryJumpTargetOut | None = None
    domain_coordinate: HistoryDomainCoordinateOut | None = None
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
    metadata_status: HistoryMetadataStatus = "complete"


class HistoryCellHistoryOut(_StrictModel):
    items: list[HistoryCellHistoryItemOut] = Field(default_factory=list)
    baseline_entry: HistoryStateEntryOut | None = None
    initial_entry: HistoryStateEntryOut | None = None
    initial_state_unavailable: bool = False
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
    "HistoryDomainCoordinateOut",
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
