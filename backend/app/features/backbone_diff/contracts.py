"""Frozen backbone diff loader contracts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.domain.backbone.snapshot import BackboneSnapshot
from app.domain.parameters.types import ValueType


@dataclass(frozen=True, slots=True)
class DiffCellInput:
    parameter_code: str
    value: str


@dataclass(frozen=True, slots=True)
class DiffConditionInput:
    source_condition_id: int
    label: str
    condition_index: int
    is_por: bool
    cells: tuple[DiffCellInput, ...] = ()


@dataclass(frozen=True, slots=True)
class DiffLayerInput:
    layer_key: str
    step_seq: str
    layer_id: str
    sort_order: int
    baseline_snapshot: BackboneSnapshot | None
    current_snapshot: BackboneSnapshot


@dataclass(frozen=True, slots=True)
class DiffParameterInput:
    parameter_code: str
    value_type: ValueType | str
    display_name: str
    category_code: str | None
    sort_order: int
    active_at_capture: bool


@dataclass(frozen=True, slots=True)
class DiffInput:
    project_id: int
    line_id: str
    process_id: str
    part_id: str
    project_name: str
    project_status: str
    captured_at: datetime
    layers: tuple[DiffLayerInput, ...]
    parameters: tuple[DiffParameterInput, ...]

    def __post_init__(self) -> None:
        if self.captured_at.tzinfo is None or self.captured_at.utcoffset() != timedelta(0):
            raise ValueError("captured_at must be UTC")
