"""Immutable backbone snapshot contracts."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.domain.errors import RuleViolationError

SNAPSHOT_VERSION = 1

_CONFIGURATION_INVALID = "backbone_snapshot_invalid"


def _configuration_invalid(message: str) -> None:
    raise RuleViolationError(message, code=_CONFIGURATION_INVALID)


def _require_positive_int(value: Any, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        _configuration_invalid(f"{field_name} must be a positive integer")
    return value


def _require_non_negative_int(value: Any, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        _configuration_invalid(f"{field_name} must be a non-negative integer")
    return value


def _require_text(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or value == "":
        _configuration_invalid(f"{field_name} must be a non-empty string")
    return value


def _optional_text(value: Any, field_name: str) -> str | None:
    if value is None:
        return None
    return _require_text(value, field_name)


def _captured_at_out(value: datetime | str) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return _require_text(value, "captured_at")


@dataclass(frozen=True, slots=True)
class BackboneSourceProject:
    """Copied source-project identity for a frozen backbone baseline."""

    project_id: int
    line_id: str
    process_id: str
    part_id: str


@dataclass(frozen=True, slots=True)
class BackboneSourceLayer:
    """Copied source-layer identity for a frozen backbone baseline."""

    layer_key: str
    step_seq: str
    layer_id: str
    eqp_type: str | None = None
    area_name: str | None = None


@dataclass(frozen=True, slots=True)
class BackboneCellValue:
    """Sparse baseline cell value."""

    parameter_code: str
    value_text: str | None = None


@dataclass(frozen=True, slots=True)
class BackboneConditionSnapshot:
    """A single source condition carried into the immutable baseline."""

    condition_id: int
    label: str
    condition_index: int
    is_por: bool
    cell_values: tuple[BackboneCellValue, ...] = ()


@dataclass(frozen=True, slots=True)
class BackboneSnapshotSpec:
    """Typed input for a Phase 4 backbone snapshot serializer."""

    source_project: BackboneSourceProject
    source_layer: BackboneSourceLayer
    captured_at: datetime | str
    conditions: tuple[BackboneConditionSnapshot, ...] = ()


def snapshot(spec: BackboneSnapshotSpec) -> dict[str, Any]:
    """Serialize a deterministic immutable backbone snapshot payload."""
    return {
        "version": SNAPSHOT_VERSION,
        "captured_at": _captured_at_out(spec.captured_at),
        "source_project": _source_project_out(spec.source_project),
        "source_layer": _source_layer_out(spec.source_layer),
        "conditions": [
            _condition_out(condition)
            for condition in sorted(
                spec.conditions,
                key=lambda item: (item.condition_index, item.condition_id, item.label),
            )
        ],
    }


def _source_project_out(source_project: BackboneSourceProject) -> dict[str, Any]:
    return {
        "project_id": _require_positive_int(source_project.project_id, "project_id"),
        "line_id": _require_text(source_project.line_id, "line_id"),
        "process_id": _require_text(source_project.process_id, "process_id"),
        "part_id": _require_text(source_project.part_id, "part_id"),
    }


def _source_layer_out(source_layer: BackboneSourceLayer) -> dict[str, Any]:
    output = {
        "layer_key": _require_text(source_layer.layer_key, "layer_key"),
        "step_seq": _require_text(source_layer.step_seq, "step_seq"),
        "layer_id": _require_text(source_layer.layer_id, "layer_id"),
        "eqp_type": _optional_text(source_layer.eqp_type, "eqp_type"),
        "area_name": _optional_text(source_layer.area_name, "area_name"),
    }
    return output


def _condition_out(condition: BackboneConditionSnapshot) -> dict[str, Any]:
    cell_values: dict[str, str] = {}
    for cell in sorted(condition.cell_values, key=lambda item: item.parameter_code):
        parameter_code = _require_text(cell.parameter_code, "parameter_code")
        if parameter_code in cell_values:
            _configuration_invalid(
                f"duplicate parameter code in condition {condition.condition_id}: {parameter_code}"
            )
        value_text = cell.value_text
        if value_text is None:
            continue
        cell_values[parameter_code] = _require_text(value_text, f"value_text[{parameter_code}]")

    return {
        "condition_id": _require_positive_int(condition.condition_id, "condition_id"),
        "label": _require_text(condition.label, "label"),
        "condition_index": _require_non_negative_int(
            condition.condition_index, "condition_index"
        ),
        "is_por": bool(condition.is_por),
        "cells": cell_values,
    }
