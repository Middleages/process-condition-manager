"""Frozen backbone diff project envelope."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.domain.backbone.diff import BackboneDiffLayerInput


@dataclass(frozen=True, slots=True)
class BackboneDiffProjectInput:
    project_id: int
    line_id: str
    process_id: str
    part_id: str
    project_name: str
    project_status: str
    captured_at: datetime
    layers: tuple[BackboneDiffLayerInput, ...]

    def __post_init__(self) -> None:
        if self.captured_at.tzinfo is None or self.captured_at.utcoffset() != timedelta(0):
            raise ValueError("captured_at must be UTC")
