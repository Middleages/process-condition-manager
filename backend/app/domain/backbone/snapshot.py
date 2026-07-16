"""Immutable backbone snapshot contracts."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Sequence

from app.domain.decimal_values import normalize_decimal
from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType

SNAPSHOT_VERSION = 1
INVALID_BACKBONE_SNAPSHOT = "invalid_backbone_snapshot"
BASELINE_UNAVAILABLE = "baseline_unavailable"
UNRESOLVED_PARAMETER_METADATA = "unresolved_parameter_metadata"

_CAPTURE_BATCH_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_CAPTURED_AT_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T"
    r"\d{2}:\d{2}:\d{2}"
    r"(?:\.\d{1,6})?Z$"
)


def _raise(code: str, message: str) -> None:
    raise RuleViolationError(message, code=code)


def _invalid(message: str) -> None:
    _raise(INVALID_BACKBONE_SNAPSHOT, message)


def _baseline_unavailable(message: str = "backbone snapshot is unavailable") -> None:
    _raise(BASELINE_UNAVAILABLE, message)


def _unresolved_metadata(message: str) -> None:
    _raise(UNRESOLVED_PARAMETER_METADATA, message)


def new_capture_batch_id() -> str:
    """Generate a lower-case 32-hex batch token."""
    return uuid.uuid4().hex


def normalize_capture_batch_id(value: Any) -> str:
    if not isinstance(value, str) or not _CAPTURE_BATCH_ID_RE.fullmatch(value):
        _invalid("capture_batch_id must be a lowercase 32-hex token")
    return value


def normalize_captured_at(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        if not _CAPTURED_AT_RE.fullmatch(value):
            _invalid("captured_at must be canonical UTC Z")
        dt = datetime.fromisoformat(value[:-1] + "+00:00")
    else:
        _invalid("captured_at must be a datetime or canonical UTC Z string")

    if dt.tzinfo is None or dt.utcoffset() != timedelta(0):
        _invalid("captured_at must be UTC")
    return dt.astimezone(timezone.utc)


def format_captured_at(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() != timedelta(0):
        _invalid("captured_at must be UTC")
    iso = value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace(
        "+00:00",
        "Z",
    )
    if iso.endswith(".000000Z"):
        return iso[:-8] + "Z"
    if "." in iso:
        head, tail = iso[:-1].split(".", 1)
        return f"{head}.{tail.rstrip('0')}Z"
    return iso


@dataclass(frozen=True, slots=True)
class BackboneSnapshotSource:
    project_id: int
    sheet_layer_id: int
    layer_key: str
    step_seq: str
    layer_id: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "project_id", _require_positive_int(self.project_id, "project_id"))
        object.__setattr__(
            self,
            "sheet_layer_id",
            _require_positive_int(self.sheet_layer_id, "sheet_layer_id"),
        )
        object.__setattr__(self, "layer_key", _require_text(self.layer_key, "layer_key"))
        object.__setattr__(self, "step_seq", _require_text(self.step_seq, "step_seq"))
        object.__setattr__(self, "layer_id", _require_text(self.layer_id, "layer_id"))


@dataclass(frozen=True, slots=True)
class BackboneSnapshotColumn:
    parameter_code: str
    value_type: ValueType | str
    display_name: str
    category_code: str | None
    sort_order: int
    active_at_capture: bool

    def __post_init__(self) -> None:
        object.__setattr__(self, "parameter_code", _require_text(self.parameter_code, "parameter_code"))
        object.__setattr__(self, "value_type", _coerce_value_type(self.value_type))
        object.__setattr__(self, "display_name", _require_text(self.display_name, "display_name"))
        if self.category_code is not None:
            object.__setattr__(self, "category_code", _require_text(self.category_code, "category_code"))
        object.__setattr__(self, "sort_order", _require_non_negative_int(self.sort_order, "sort_order"))
        object.__setattr__(self, "active_at_capture", _require_bool(self.active_at_capture, "active_at_capture"))


@dataclass(frozen=True, slots=True)
class BackboneSnapshotCell:
    parameter_code: str
    value: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "parameter_code", _require_text(self.parameter_code, "parameter_code"))
        object.__setattr__(self, "value", _require_text(self.value, "value", allow_empty=True))


@dataclass(frozen=True, slots=True)
class BackboneSnapshotCondition:
    source_condition_id: int
    label: str
    condition_index: int
    is_por: bool
    cells: tuple[BackboneSnapshotCell, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "source_condition_id",
            _require_positive_int(self.source_condition_id, "source_condition_id"),
        )
        object.__setattr__(self, "label", _require_text(self.label, "label"))
        object.__setattr__(
            self,
            "condition_index",
            _require_non_negative_int(self.condition_index, "condition_index"),
        )
        object.__setattr__(self, "is_por", _require_bool(self.is_por, "is_por"))
        cells = tuple(self.cells)
        for cell in cells:
            if not isinstance(cell, BackboneSnapshotCell):
                _invalid("cells must contain BackboneSnapshotCell values")
        seen_codes: set[str] = set()
        canonical_cells: list[BackboneSnapshotCell] = []
        for cell in sorted(cells, key=lambda item: item.parameter_code):
            if cell.parameter_code in seen_codes:
                _invalid(
                    f"duplicate parameter_code in condition {self.source_condition_id}: {cell.parameter_code}"
                )
            seen_codes.add(cell.parameter_code)
            canonical_cells.append(cell)
        object.__setattr__(self, "cells", tuple(canonical_cells))


@dataclass(frozen=True, slots=True)
class BackboneSnapshot:
    schema_version: int = SNAPSHOT_VERSION
    capture_batch_id: str = field(default_factory=new_capture_batch_id)
    captured_at: datetime | str = field(default_factory=lambda: datetime.now(timezone.utc))
    source: BackboneSnapshotSource | None = None
    columns: tuple[BackboneSnapshotColumn, ...] = ()
    conditions: tuple[BackboneSnapshotCondition, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "schema_version", _require_exact_schema_version(self.schema_version))
        object.__setattr__(self, "capture_batch_id", normalize_capture_batch_id(self.capture_batch_id))
        object.__setattr__(self, "captured_at", normalize_captured_at(self.captured_at))
        if not isinstance(self.source, BackboneSnapshotSource):
            _invalid("source must be BackboneSnapshotSource")
        columns = tuple(self.columns)
        for column in columns:
            if not isinstance(column, BackboneSnapshotColumn):
                _invalid("columns must contain BackboneSnapshotColumn values")
        conditions = tuple(self.conditions)
        for condition in conditions:
            if not isinstance(condition, BackboneSnapshotCondition):
                _invalid("conditions must contain BackboneSnapshotCondition values")
        object.__setattr__(self, "columns", columns)
        object.__setattr__(self, "conditions", conditions)
        _validate_snapshot_graph(self)


def parse_backbone_snapshot(raw: Any) -> BackboneSnapshot:
    """Parse and validate an exact backbone snapshot JSON document."""
    if raw is None:
        _baseline_unavailable()
    if isinstance(raw, BackboneSnapshot):
        return raw
    if not isinstance(raw, Mapping):
        _invalid("snapshot must be a mapping")

    _require_exact_keys(
        raw,
        {"schema_version", "capture_batch_id", "captured_at", "source", "columns", "conditions"},
        "snapshot",
    )
    source = _parse_source(raw["source"])
    columns = _parse_columns(raw["columns"])
    column_by_code = {column.parameter_code: column for column in columns}
    conditions = _parse_conditions(raw["conditions"], column_by_code)
    return BackboneSnapshot(
        schema_version=raw["schema_version"],
        capture_batch_id=raw["capture_batch_id"],
        captured_at=raw["captured_at"],
        source=source,
        columns=columns,
        conditions=conditions,
    )


def serialize_backbone_snapshot(
    snapshot: BackboneSnapshot | Mapping[str, Any] | None,
) -> dict[str, Any]:
    parsed = parse_backbone_snapshot(snapshot)
    return {
        "schema_version": parsed.schema_version,
        "capture_batch_id": parsed.capture_batch_id,
        "captured_at": format_captured_at(parsed.captured_at),
        "source": _source_out(parsed.source),
        "columns": [_column_out(column) for column in sorted(parsed.columns, key=_column_sort_key)],
        "conditions": [
            _condition_out(condition)
            for condition in sorted(parsed.conditions, key=_condition_sort_key)
        ],
    }


snapshot = serialize_backbone_snapshot


def backbone_snapshot_hash(snapshot_like: BackboneSnapshot | Mapping[str, Any] | None) -> str:
    canonical_json = json.dumps(
        serialize_backbone_snapshot(snapshot_like),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    digest = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _parse_source(raw: Any) -> BackboneSnapshotSource:
    if not isinstance(raw, Mapping):
        _invalid("source must be a mapping")
    _require_exact_keys(raw, {"project_id", "sheet_layer_id", "layer_key", "step_seq", "layer_id"}, "source")
    return BackboneSnapshotSource(
        project_id=raw["project_id"],
        sheet_layer_id=raw["sheet_layer_id"],
        layer_key=raw["layer_key"],
        step_seq=raw["step_seq"],
        layer_id=raw["layer_id"],
    )


def _parse_columns(raw: Any) -> tuple[BackboneSnapshotColumn, ...]:
    items = _require_sequence(raw, "columns")
    parsed = [
        BackboneSnapshotColumn(
            parameter_code=item["parameter_code"],
            value_type=item["value_type"],
            display_name=item["display_name"],
            category_code=item["category_code"],
            sort_order=item["sort_order"],
            active_at_capture=item["active_at_capture"],
        )
        for item in (
            _require_mapping(item, "column")
            for item in items
        )
    ]
    _validate_unique(parsed, lambda item: item.parameter_code, "duplicate parameter_code")
    return tuple(sorted(parsed, key=_column_sort_key))


def _parse_conditions(
    raw: Any,
    column_by_code: Mapping[str, BackboneSnapshotColumn],
) -> tuple[BackboneSnapshotCondition, ...]:
    items = _require_sequence(raw, "conditions")
    parsed: list[BackboneSnapshotCondition] = []
    for item in items:
        mapping = _require_mapping(item, "condition")
        _require_exact_keys(mapping, {"source_condition_id", "label", "condition_index", "is_por", "cells"}, "condition")
        cells_raw = _require_mapping(mapping["cells"], "cells")
        cells: list[BackboneSnapshotCell] = []
        for parameter_code in sorted(cells_raw):
            if parameter_code not in column_by_code:
                _unresolved_metadata(f"unknown parameter_code in snapshot cell: {parameter_code}")
            column = column_by_code[parameter_code]
            cells.append(
                BackboneSnapshotCell(
                    parameter_code=parameter_code,
                    value=_canonical_cell_value(column.value_type, cells_raw[parameter_code], parameter_code),
                )
            )
        parsed.append(
            BackboneSnapshotCondition(
                source_condition_id=mapping["source_condition_id"],
                label=mapping["label"],
                condition_index=mapping["condition_index"],
                is_por=mapping["is_por"],
                cells=tuple(cells),
            )
        )
    _validate_unique(parsed, lambda item: item.source_condition_id, "duplicate source_condition_id")
    _validate_unique(parsed, lambda item: item.condition_index, "duplicate condition_index")
    return tuple(sorted(parsed, key=_condition_sort_key))


def _validate_snapshot_graph(snapshot: BackboneSnapshot) -> None:
    column_codes: set[str] = set()
    for column in snapshot.columns:
        if column.parameter_code in column_codes:
            _invalid(f"duplicate column code: {column.parameter_code}")
        column_codes.add(column.parameter_code)
    condition_ids: set[int] = set()
    condition_indexes: set[int] = set()
    for condition in snapshot.conditions:
        if condition.source_condition_id in condition_ids:
            _invalid(f"duplicate source_condition_id: {condition.source_condition_id}")
        if condition.condition_index in condition_indexes:
            _invalid(f"duplicate condition_index: {condition.condition_index}")
        condition_ids.add(condition.source_condition_id)
        condition_indexes.add(condition.condition_index)
        for cell in condition.cells:
            if cell.parameter_code not in column_codes:
                _invalid(f"cell references missing column: {cell.parameter_code}")


def _source_out(source: BackboneSnapshotSource) -> dict[str, Any]:
    return {
        "project_id": source.project_id,
        "sheet_layer_id": source.sheet_layer_id,
        "layer_key": source.layer_key,
        "step_seq": source.step_seq,
        "layer_id": source.layer_id,
    }


def _column_out(column: BackboneSnapshotColumn) -> dict[str, Any]:
    return {
        "parameter_code": column.parameter_code,
        "value_type": column.value_type.value,
        "display_name": column.display_name,
        "category_code": column.category_code,
        "sort_order": column.sort_order,
        "active_at_capture": column.active_at_capture,
    }


def _condition_out(condition: BackboneSnapshotCondition) -> dict[str, Any]:
    return {
        "source_condition_id": condition.source_condition_id,
        "label": condition.label,
        "condition_index": condition.condition_index,
        "is_por": condition.is_por,
        "cells": {cell.parameter_code: cell.value for cell in condition.cells},
    }


def _canonical_cell_value(value_type: ValueType, value: Any, parameter_code: str) -> str:
    if not isinstance(value, str):
        _invalid(f"cell value must be a string for {parameter_code}")
    if value_type is ValueType.NUMBER:
        try:
            return normalize_decimal(value)
        except RuleViolationError as exc:
            _invalid(f"invalid number for {parameter_code}: {exc.code}")
    if value_type is ValueType.CHOICE:
        if value == "":
            _invalid(f"choice value must not be empty for {parameter_code}")
        return value
    return value


def _coerce_value_type(value: ValueType | str) -> ValueType:
    try:
        return value if isinstance(value, ValueType) else ValueType(value)
    except Exception as exc:  # pragma: no cover - ValueType raises ValueError on invalid input
        _invalid(f"invalid value_type: {value}")
        raise AssertionError from exc


def _require_sequence(value: Any, field_name: str) -> Sequence[Any]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        _invalid(f"{field_name} must be a sequence")
    return value


def _require_mapping(value: Any, field_name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        _invalid(f"{field_name} must be a mapping")
    return value


def _require_exact_keys(mapping: Mapping[str, Any], expected: set[str], field_name: str) -> None:
    keys = set(mapping.keys())
    if keys != expected:
        missing = sorted(expected - keys)
        extra = sorted(keys - expected)
        detail: list[str] = []
        if missing:
            detail.append(f"missing: {', '.join(missing)}")
        if extra:
            detail.append(f"extra: {', '.join(extra)}")
        _invalid(f"{field_name} keys mismatch ({'; '.join(detail)})")


def _require_text(value: Any, field_name: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (value == "" and not allow_empty):
        _invalid(f"{field_name} must be a non-empty string")
    return value


def _require_bool(value: Any, field_name: str) -> bool:
    if not isinstance(value, bool):
        _invalid(f"{field_name} must be a boolean")
    return value


def _require_int(value: Any, field_name: str, *, non_negative: bool) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        _invalid(f"{field_name} must be an integer")
    if non_negative and value < 0:
        _invalid(f"{field_name} must be non-negative")
    if not non_negative and value <= 0:
        _invalid(f"{field_name} must be positive")
    return value


def _require_positive_int(value: Any, field_name: str) -> int:
    return _require_int(value, field_name, non_negative=False)


def _require_non_negative_int(value: Any, field_name: str) -> int:
    return _require_int(value, field_name, non_negative=True)


def _require_exact_schema_version(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value != SNAPSHOT_VERSION:
        _invalid(f"unsupported schema_version: {value}")
    return value


def _validate_unique(items: Sequence[Any], key, message: str) -> None:
    seen: set[Any] = set()
    for item in items:
        key_value = key(item)
        if key_value in seen:
            _invalid(f"{message}: {key_value}")
        seen.add(key_value)


def _column_sort_key(column: BackboneSnapshotColumn) -> tuple[int, str]:
    return column.sort_order, column.parameter_code


def _condition_sort_key(condition: BackboneSnapshotCondition) -> tuple[int, int]:
    return condition.condition_index, condition.source_condition_id


__all__ = [
    "BASELINE_UNAVAILABLE",
    "BackboneSnapshot",
    "BackboneSnapshotCell",
    "BackboneSnapshotColumn",
    "BackboneSnapshotCondition",
    "BackboneSnapshotSource",
    "INVALID_BACKBONE_SNAPSHOT",
    "SNAPSHOT_VERSION",
    "UNRESOLVED_PARAMETER_METADATA",
    "backbone_snapshot_hash",
    "format_captured_at",
    "new_capture_batch_id",
    "normalize_capture_batch_id",
    "normalize_captured_at",
    "parse_backbone_snapshot",
    "serialize_backbone_snapshot",
    "snapshot",
]
