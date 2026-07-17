"""Immutable backbone diff contracts and pure comparison engine."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, NoReturn, cast

from app.domain.backbone.snapshot import (
    UNRESOLVED_PARAMETER_METADATA,
    BackboneSnapshot,
    BackboneSnapshotColumn,
    serialize_backbone_snapshot,
)
from app.domain.decimal_values import normalize_decimal
from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType

DIFF_BASIS_INVALID = "diff_basis_invalid"

ROW_STATUS_MATCHED = "matched"
ROW_STATUS_ADDED = "added"
ROW_STATUS_REMOVED = "removed"

ITEM_KIND_ROW_METADATA = "row_metadata"
ITEM_KIND_CELL = "cell"

CLASSIFICATION_ADDED = "added"
CLASSIFICATION_CHANGED = "changed"
CLASSIFICATION_CLEARED = "cleared"
CLASSIFICATION_REMOVED = "removed"
CLASSIFICATION_UNCHANGED = "unchanged"

METADATA_FIELD_ORDER = {"label": 0, "condition_index": 1, "is_por": 2}
STATUS_RANK = {ROW_STATUS_MATCHED: 0, ROW_STATUS_ADDED: 1, ROW_STATUS_REMOVED: 2}
ITEM_KIND_RANK = {ITEM_KIND_ROW_METADATA: 0, ITEM_KIND_CELL: 1}


def _diff_basis_invalid(message: str, *, details: dict[str, object] | None = None) -> NoReturn:
    raise RuleViolationError(message, code=DIFF_BASIS_INVALID, details=details)


def _unresolved_parameter_metadata(
    message: str, *, details: dict[str, object] | None = None
) -> NoReturn:
    raise RuleViolationError(message, code=UNRESOLVED_PARAMETER_METADATA, details=details)


@dataclass(frozen=True, slots=True)
class BackboneDiffCurrentParameter:
    code: str
    value_type: ValueType | str
    display_name: str
    category_code: str | None
    sort_order: int
    active: bool

    def __post_init__(self) -> None:
        object.__setattr__(self, "code", _require_text(self.code, "code"))
        object.__setattr__(self, "value_type", _coerce_value_type(self.value_type))
        object.__setattr__(self, "display_name", _require_text(self.display_name, "display_name"))
        if self.category_code is not None:
            object.__setattr__(
                self, "category_code", _require_text(self.category_code, "category_code")
            )
        object.__setattr__(
            self, "sort_order", _require_non_negative_int(self.sort_order, "sort_order")
        )
        object.__setattr__(self, "active", _require_bool(self.active, "active"))


@dataclass(frozen=True, slots=True)
class BackboneDiffCurrentCell:
    parameter_code: str
    value: str | None

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "parameter_code", _require_text(self.parameter_code, "parameter_code")
        )
        if self.value is not None and not isinstance(self.value, str):
            _diff_basis_invalid("current cell value must be a string or null")


@dataclass(frozen=True, slots=True)
class BackboneDiffCurrentCondition:
    id: int
    source_condition_id: int | None
    label: str
    condition_index: int
    is_por: bool
    cells: tuple[BackboneDiffCurrentCell, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", _require_positive_int(self.id, "id"))
        if self.source_condition_id is not None:
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
        seen: set[str] = set()
        canonical_cells: list[BackboneDiffCurrentCell] = []
        for cell in sorted(cells, key=lambda item: item.parameter_code):
            if not isinstance(cell, BackboneDiffCurrentCell):
                _diff_basis_invalid("cells must contain BackboneDiffCurrentCell values")
            if cell.parameter_code in seen:
                _diff_basis_invalid(
                    "duplicate current parameter_code in condition "
                    f"{self.id}: {cell.parameter_code}"
                )
            seen.add(cell.parameter_code)
            canonical_cells.append(cell)
        object.__setattr__(self, "cells", tuple(canonical_cells))

    def cells_by_code(self) -> dict[str, str | None]:
        return {cell.parameter_code: cell.value for cell in self.cells}


@dataclass(frozen=True, slots=True)
class BackboneDiffCurrentLayerSource:
    project_id: int
    sheet_layer_id: int
    layer_key: str
    step_seq: str
    layer_id: str
    sort_order: int
    source_project_id: int | None
    source_layer_key: str | None

    def __post_init__(self) -> None:
        object.__setattr__(self, "project_id", _require_positive_int(self.project_id, "project_id"))
        object.__setattr__(
            self, "sheet_layer_id", _require_positive_int(self.sheet_layer_id, "sheet_layer_id")
        )
        object.__setattr__(self, "layer_key", _require_text(self.layer_key, "layer_key"))
        object.__setattr__(self, "step_seq", _require_text(self.step_seq, "step_seq"))
        object.__setattr__(self, "layer_id", _require_text(self.layer_id, "layer_id"))
        object.__setattr__(
            self, "sort_order", _require_non_negative_int(self.sort_order, "sort_order")
        )
        if self.source_project_id is not None:
            object.__setattr__(
                self,
                "source_project_id",
                _require_positive_int(self.source_project_id, "source_project_id"),
            )
        if self.source_layer_key is not None:
            object.__setattr__(
                self,
                "source_layer_key",
                _require_text(self.source_layer_key, "source_layer_key"),
            )


@dataclass(frozen=True, slots=True)
class BackboneDiffLayerInput:
    layer_key: str
    layer_sort_order: int
    current_source: BackboneDiffCurrentLayerSource
    baseline_snapshot: BackboneSnapshot | None
    current_conditions: tuple[BackboneDiffCurrentCondition, ...]
    current_parameters: tuple[BackboneDiffCurrentParameter, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "layer_key", _require_text(self.layer_key, "layer_key"))
        object.__setattr__(
            self,
            "layer_sort_order",
            _require_non_negative_int(self.layer_sort_order, "layer_sort_order"),
        )
        if not isinstance(self.current_source, BackboneDiffCurrentLayerSource):
            _diff_basis_invalid("current_source must be BackboneDiffCurrentLayerSource")
        if self.current_source.layer_key != self.layer_key:
            _diff_basis_invalid("current_source.layer_key must match layer_key")
        if self.current_source.sort_order != self.layer_sort_order:
            _diff_basis_invalid("current_source.sort_order must match layer_sort_order")
        if self.baseline_snapshot is not None and not isinstance(
            self.baseline_snapshot, BackboneSnapshot
        ):
            _diff_basis_invalid("baseline_snapshot must be BackboneSnapshot or null")
        conditions = tuple(self.current_conditions)
        parameters = tuple(self.current_parameters)
        for condition in conditions:
            if not isinstance(condition, BackboneDiffCurrentCondition):
                _diff_basis_invalid(
                    "current_conditions must contain BackboneDiffCurrentCondition values"
                )
        for parameter in parameters:
            if not isinstance(parameter, BackboneDiffCurrentParameter):
                _diff_basis_invalid(
                    "current_parameters must contain BackboneDiffCurrentParameter values"
                )
        if len({condition.id for condition in conditions}) != len(conditions):
            _diff_basis_invalid("duplicate current condition id")
        parameter_by_code = {parameter.code: parameter for parameter in parameters}
        if len(parameter_by_code) != len(parameters):
            _diff_basis_invalid("duplicate current parameter code")
        object.__setattr__(
            self, "current_conditions", tuple(sorted(conditions, key=_current_condition_sort_key))
        )
        canonical_parameters = tuple(sorted(parameters, key=_current_parameter_sort_key))
        # A project-level registry is already canonical and immutable. Retain that tuple so
        # every layer can share one descriptor graph instead of copying it per layer.
        if parameters == canonical_parameters:
            canonical_parameters = parameters
        object.__setattr__(self, "current_parameters", canonical_parameters)


@dataclass(frozen=True, slots=True)
class BackboneDiffMetadataChange:
    field_name: Literal["label", "condition_index", "is_por"]
    baseline_value: Any
    current_value: Any


@dataclass(frozen=True, slots=True)
class BackboneDiffCellChange:
    parameter_code: str
    sort_order: int
    classification: Literal["added", "changed", "cleared", "removed", "unchanged"]
    reason: str
    baseline_value: str | None
    current_value: str | None


@dataclass(frozen=True, slots=True)
class BackboneDiffRow:
    layer_key: str
    row_status: Literal["matched", "added", "removed"]
    effective_condition_index: int
    identity: int
    baseline_source_condition_id: int | None
    current_id: int | None
    baseline_condition_index: int | None
    current_condition_index: int | None
    baseline_label: str | None
    current_label: str | None
    baseline_is_por: bool | None
    current_is_por: bool | None
    metadata_changes: tuple[BackboneDiffMetadataChange, ...] = ()
    cell_changes: tuple[BackboneDiffCellChange, ...] = ()

    def __post_init__(self) -> None:
        if self.row_status not in STATUS_RANK:
            _diff_basis_invalid(f"invalid row status: {self.row_status}")


@dataclass(frozen=True, slots=True)
class BackboneDiffPreviewItem:
    layer_key: str
    layer_sort_order: int
    effective_condition_index: int
    row_status: Literal["matched", "added", "removed"]
    identity: int
    item_kind: Literal["row_metadata", "cell"]
    item_sort_key: tuple[Any, ...]
    classification: Literal["added", "changed", "cleared", "removed", "unchanged"]
    reason: str
    field_name: str | None = None
    parameter_code: str | None = None
    baseline_value: str | None = None
    current_value: str | None = None


@dataclass(frozen=True, slots=True)
class BackboneDiffLayerResult:
    layer_key: str
    layer_sort_order: int
    basis_hash: str
    baseline_unavailable: bool
    ambiguous_lineage_count: int
    matched_row_count: int
    added_row_count: int
    removed_row_count: int
    row_metadata_change_count: int
    added_cell_count: int
    removed_cell_count: int
    cleared_cell_count: int
    changed_cell_count: int
    unchanged_cell_count: int
    rows: tuple[BackboneDiffRow, ...]

    @property
    def preview_items(self) -> tuple[BackboneDiffPreviewItem, ...]:
        items = [
            item for row in self.rows for item in _row_preview_items(self.layer_sort_order, row)
        ]
        return tuple(sorted(items, key=_preview_item_sort_key))

    @property
    def item_count(self) -> int:
        return len(self.preview_items)


@dataclass(frozen=True, slots=True)
class BackboneDiffResult:
    basis_hash: str
    layer_results: tuple[BackboneDiffLayerResult, ...]

    @property
    def preview_items(self) -> tuple[BackboneDiffPreviewItem, ...]:
        items = [item for layer in self.layer_results for item in layer.preview_items]
        return tuple(sorted(items, key=_preview_item_sort_key))

    @property
    def item_count(self) -> int:
        return len(self.preview_items)

    @property
    def matched_row_count(self) -> int:
        return sum(layer.matched_row_count for layer in self.layer_results)

    @property
    def added_row_count(self) -> int:
        return sum(layer.added_row_count for layer in self.layer_results)

    @property
    def removed_row_count(self) -> int:
        return sum(layer.removed_row_count for layer in self.layer_results)

    @property
    def ambiguous_lineage_count(self) -> int:
        return sum(layer.ambiguous_lineage_count for layer in self.layer_results)


@dataclass(frozen=True, slots=True)
class _PreparedCoordinate:
    parameter_code: str
    sort_order: int
    baseline_has_column: bool
    current_has_column: bool


@dataclass(frozen=True, slots=True)
class _PreparedCurrentCondition:
    condition: BackboneDiffCurrentCondition
    canonical_values_by_code: dict[str, str | None]
    payload_cells: tuple[tuple[str, str | None], ...]


@dataclass(frozen=True, slots=True)
class _PreparedLayer:
    layer_input: BackboneDiffLayerInput
    basis_bytes: bytes
    basis_hash: str
    baseline_columns: dict[str, BackboneSnapshotColumn]
    baseline_universe: set[str]
    current_selected: tuple[BackboneDiffCurrentParameter, ...]
    current_descriptor_by_code: dict[str, BackboneDiffCurrentParameter]
    current_universe: set[str]
    current_conditions: tuple[_PreparedCurrentCondition, ...]
    coordinate_plan: dict[str, _PreparedCoordinate]
    coordinate_codes: tuple[str, ...]
    added_row_codes: tuple[str, ...]
    removed_row_codes: tuple[str, ...]


@dataclass(slots=True)
class _PrepareCache:
    baseline_columns_by_snapshot_id: dict[int, dict[str, BackboneSnapshotColumn]]
    baseline_payload_by_snapshot_id: dict[int, dict[str, Any]]
    current_selected_by_universe_key: dict[
        tuple[tuple[BackboneDiffCurrentParameter, ...], frozenset[str]],
        tuple[BackboneDiffCurrentParameter, ...],
    ]
    current_parameter_payload_by_selected_key: dict[
        tuple[BackboneDiffCurrentParameter, ...], tuple[dict[str, Any], ...]
    ]
    coordinate_plan_by_descriptor_shape: dict[
        tuple[frozenset[tuple[str, ValueType, int]], int],
        tuple[
            tuple[str, ...],
            dict[str, _PreparedCoordinate],
            tuple[str, ...],
            tuple[str, ...],
        ],
    ]


def _prepare_layer(
    layer_input: BackboneDiffLayerInput,
    *,
    cache: _PrepareCache | None = None,
) -> _PreparedLayer:
    cache = cache or _PrepareCache({}, {}, {}, {}, {})
    baseline_columns = (
        {}
        if layer_input.baseline_snapshot is None
        else _baseline_columns_for_snapshot(layer_input.baseline_snapshot, cache)
    )
    baseline_universe = set(baseline_columns)
    current_selected = _selected_current_descriptors(layer_input, cache)
    current_descriptor_by_code = {parameter.code: parameter for parameter in current_selected}
    current_universe = set(current_descriptor_by_code)
    # Repository hydration creates a distinct snapshot object per layer even when
    # their column registries are identical.  The comparison plan only depends on
    # code/type/order plus the already-selected immutable current registry, so use
    # that structural shape instead of snapshot identity.  Including the type lets
    # a cache hit also prove that the compatibility check already succeeded.
    baseline_descriptor_shape = frozenset(
        (
            parameter_code,
            cast(ValueType, column.value_type),
            column.sort_order,
        )
        for parameter_code, column in baseline_columns.items()
    )
    coordinate_plan_key = (baseline_descriptor_shape, id(current_selected))
    cached_coordinate_plan = cache.coordinate_plan_by_descriptor_shape.get(coordinate_plan_key)
    if cached_coordinate_plan is None:
        _validate_parameter_type_compatibility(baseline_columns, current_descriptor_by_code)
        coordinate_codes = tuple(
            _ordered_coordinate_codes(
                baseline_columns,
                current_descriptor_by_code,
                baseline_universe,
                current_universe,
            )
        )
        coordinate_plan = {
            parameter_code: _PreparedCoordinate(
                parameter_code=parameter_code,
                sort_order=(
                    current_descriptor_by_code.get(parameter_code)
                    or baseline_columns[parameter_code]
                ).sort_order,
                baseline_has_column=parameter_code in baseline_universe,
                current_has_column=parameter_code in current_universe,
            )
            for parameter_code in coordinate_codes
        }
        added_row_codes = tuple(
            _ordered_added_row_codes(
                baseline_columns,
                current_descriptor_by_code,
                current_universe,
            )
        )
        removed_row_codes = tuple(
            _ordered_baseline_row_codes(
                baseline_columns,
                baseline_universe,
            )
        )
        cached_coordinate_plan = (
            coordinate_codes,
            coordinate_plan,
            added_row_codes,
            removed_row_codes,
        )
        cache.coordinate_plan_by_descriptor_shape[coordinate_plan_key] = cached_coordinate_plan
    coordinate_codes, coordinate_plan, added_row_codes, removed_row_codes = cached_coordinate_plan

    current_conditions = tuple(
        _prepare_current_condition(condition, baseline_columns, current_descriptor_by_code)
        for condition in layer_input.current_conditions
    )
    prepared_for_payload = _PreparedLayer(
        layer_input=layer_input,
        basis_bytes=b"",
        basis_hash="",
        baseline_columns=baseline_columns,
        baseline_universe=baseline_universe,
        current_selected=current_selected,
        current_descriptor_by_code=current_descriptor_by_code,
        current_universe=current_universe,
        current_conditions=current_conditions,
        coordinate_plan=coordinate_plan,
        coordinate_codes=coordinate_codes,
        added_row_codes=added_row_codes,
        removed_row_codes=removed_row_codes,
    )
    basis_bytes = _layer_basis_bytes(prepared_for_payload, cache)
    return _PreparedLayer(
        layer_input=layer_input,
        basis_bytes=basis_bytes,
        basis_hash=_hash_bytes(basis_bytes),
        baseline_columns=baseline_columns,
        baseline_universe=baseline_universe,
        current_selected=current_selected,
        current_descriptor_by_code=current_descriptor_by_code,
        current_universe=current_universe,
        current_conditions=current_conditions,
        coordinate_plan=coordinate_plan,
        coordinate_codes=coordinate_codes,
        added_row_codes=added_row_codes,
        removed_row_codes=removed_row_codes,
    )


def compare_backbone_layer(layer_input: BackboneDiffLayerInput) -> BackboneDiffLayerResult:
    prepared = _prepare_layer(layer_input)
    return _compare_prepared_layer(prepared)


def _compare_prepared_layer(prepared: _PreparedLayer) -> BackboneDiffLayerResult:
    layer_input = prepared.layer_input
    if layer_input.baseline_snapshot is None:
        return BackboneDiffLayerResult(
            layer_key=layer_input.layer_key,
            layer_sort_order=layer_input.layer_sort_order,
            basis_hash=prepared.basis_hash,
            baseline_unavailable=True,
            ambiguous_lineage_count=0,
            matched_row_count=0,
            added_row_count=0,
            removed_row_count=0,
            row_metadata_change_count=0,
            added_cell_count=0,
            removed_cell_count=0,
            cleared_cell_count=0,
            changed_cell_count=0,
            unchanged_cell_count=0,
            rows=(),
        )

    baseline_snapshot = layer_input.baseline_snapshot
    assert baseline_snapshot is not None

    current_candidates: dict[int, list[BackboneDiffCurrentCondition]] = defaultdict(list)
    for condition in layer_input.current_conditions:
        if condition.source_condition_id is not None:
            current_candidates[condition.source_condition_id].append(condition)
    prepared_current_conditions_by_id = {
        prepared_condition.condition.id: prepared_condition
        for prepared_condition in prepared.current_conditions
    }

    rows: list[BackboneDiffRow] = []
    emitted_current_ids: set[int] = set()
    ambiguous_lineage_count = 0

    for baseline_condition in baseline_snapshot.conditions:
        baseline_cells_by_code = {
            cell.parameter_code: cell.value for cell in baseline_condition.cells
        }
        candidates = current_candidates.get(baseline_condition.source_condition_id, [])
        if not candidates:
            rows.append(
                _removed_row(
                    layer_input.layer_key,
                    baseline_condition,
                    baseline_cells_by_code,
                    prepared,
                )
            )
            continue

        ordered_candidates = sorted(candidates, key=_current_condition_sort_key)
        match = ordered_candidates[0]
        emitted_current_ids.add(match.id)
        match_prepared = prepared_current_conditions_by_id[match.id]
        rows.append(
            _matched_row(
                layer_input.layer_key,
                baseline_condition,
                match,
                baseline_cells_by_code,
                match_prepared,
                prepared,
            )
        )

        if len(ordered_candidates) > 1:
            ambiguous_lineage_count += 1
        for duplicate in ordered_candidates[1:]:
            emitted_current_ids.add(duplicate.id)
            duplicate_prepared = prepared_current_conditions_by_id[duplicate.id]
            rows.append(
                _added_row(
                    layer_input.layer_key,
                    duplicate,
                    duplicate_prepared,
                    prepared,
                )
            )

    for condition in layer_input.current_conditions:
        if condition.id in emitted_current_ids:
            continue
        current_prepared = prepared_current_conditions_by_id[condition.id]
        rows.append(
            _added_row(
                layer_input.layer_key,
                condition,
                current_prepared,
                prepared,
            )
        )

    rows.sort(key=_row_sort_key)

    matched_row_count = 0
    added_row_count = 0
    removed_row_count = 0
    row_metadata_change_count = 0
    added_cell_count = 0
    removed_cell_count = 0
    cleared_cell_count = 0
    changed_cell_count = 0
    unchanged_cell_count = 0
    for row in rows:
        if row.row_status == ROW_STATUS_MATCHED:
            matched_row_count += 1
        elif row.row_status == ROW_STATUS_ADDED:
            added_row_count += 1
        else:
            removed_row_count += 1
        row_metadata_change_count += len(row.metadata_changes)
        for change in row.cell_changes:
            if change.classification == CLASSIFICATION_ADDED:
                added_cell_count += 1
            elif change.classification == CLASSIFICATION_REMOVED:
                removed_cell_count += 1
            elif change.classification == CLASSIFICATION_CLEARED:
                cleared_cell_count += 1
            elif change.classification == CLASSIFICATION_CHANGED:
                changed_cell_count += 1
            elif change.classification == CLASSIFICATION_UNCHANGED:
                unchanged_cell_count += 1

    return BackboneDiffLayerResult(
        layer_key=layer_input.layer_key,
        layer_sort_order=layer_input.layer_sort_order,
        basis_hash=prepared.basis_hash,
        baseline_unavailable=False,
        ambiguous_lineage_count=ambiguous_lineage_count,
        matched_row_count=matched_row_count,
        added_row_count=added_row_count,
        removed_row_count=removed_row_count,
        row_metadata_change_count=row_metadata_change_count,
        added_cell_count=added_cell_count,
        removed_cell_count=removed_cell_count,
        cleared_cell_count=cleared_cell_count,
        changed_cell_count=changed_cell_count,
        unchanged_cell_count=unchanged_cell_count,
        rows=tuple(rows),
    )


def compare_backbone(
    layer_inputs: tuple[BackboneDiffLayerInput, ...] | list[BackboneDiffLayerInput],
) -> BackboneDiffResult:
    canonical_layers = tuple(sorted(layer_inputs, key=_layer_input_sort_key))
    cache = _PrepareCache({}, {}, {}, {}, {})
    prepared_layers = tuple(
        _prepare_layer(layer_input, cache=cache) for layer_input in canonical_layers
    )
    return BackboneDiffResult(
        basis_hash=_hash_project_bytes(prepared_layers),
        layer_results=tuple(_compare_prepared_layer(prepared) for prepared in prepared_layers),
    )


def backbone_diff_layer_basis_hash(layer_input: BackboneDiffLayerInput) -> str:
    return _prepare_layer(layer_input).basis_hash


def backbone_diff_basis_hash(
    layer_inputs: tuple[BackboneDiffLayerInput, ...] | list[BackboneDiffLayerInput],
) -> str:
    canonical_layers = tuple(sorted(layer_inputs, key=_layer_input_sort_key))
    cache = _PrepareCache({}, {}, {}, {}, {})
    prepared_layers = tuple(
        _prepare_layer(layer_input, cache=cache) for layer_input in canonical_layers
    )
    return _hash_project_bytes(prepared_layers)


def _layer_basis_payload(layer_input: BackboneDiffLayerInput) -> dict[str, Any]:
    cache = _PrepareCache({}, {}, {}, {}, {})
    return _layer_basis_payload_from_prepared(_prepare_layer(layer_input, cache=cache), cache)


def _layer_basis_bytes(prepared: _PreparedLayer, cache: _PrepareCache) -> bytes:
    return json.dumps(
        _layer_basis_payload_from_prepared(prepared, cache),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _layer_basis_payload_from_prepared(
    prepared: _PreparedLayer, cache: _PrepareCache
) -> dict[str, Any]:
    layer_input = prepared.layer_input
    baseline_payload = (
        None
        if layer_input.baseline_snapshot is None
        else _serialize_backbone_snapshot_cached(layer_input.baseline_snapshot, cache)
    )
    current_payload = [
        {
            "id": condition.condition.id,
            "source_condition_id": condition.condition.source_condition_id,
            "label": condition.condition.label,
            "condition_index": condition.condition.condition_index,
            "is_por": condition.condition.is_por,
            "cells": [
                {"parameter_code": code, "value": value} for code, value in condition.payload_cells
            ],
        }
        for condition in prepared.current_conditions
    ]
    selected_key = prepared.current_selected
    current_parameters = cache.current_parameter_payload_by_selected_key.get(selected_key)
    if current_parameters is None:
        current_parameters = tuple(
            _current_parameter_payload(parameter) for parameter in prepared.current_selected
        )
        cache.current_parameter_payload_by_selected_key[selected_key] = current_parameters
    return {
        "baseline_snapshot": baseline_payload,
        "current_conditions": current_payload,
        "current_source": _source_payload(layer_input.current_source),
        "current_parameters": list(current_parameters),
        "layer_key": layer_input.layer_key,
        "layer_sort_order": layer_input.layer_sort_order,
    }


def _serialize_backbone_snapshot_cached(
    baseline_snapshot: BackboneSnapshot, cache: _PrepareCache
) -> dict[str, Any]:
    baseline_snapshot_id = id(baseline_snapshot)
    snapshot = cache.baseline_payload_by_snapshot_id.get(baseline_snapshot_id)
    if snapshot is None:
        snapshot = serialize_backbone_snapshot(baseline_snapshot)
        cache.baseline_payload_by_snapshot_id[baseline_snapshot_id] = snapshot
    return snapshot


def _baseline_columns_for_snapshot(
    baseline_snapshot: BackboneSnapshot, cache: _PrepareCache
) -> dict[str, BackboneSnapshotColumn]:
    baseline_snapshot_id = id(baseline_snapshot)
    columns = cache.baseline_columns_by_snapshot_id.get(baseline_snapshot_id)
    if columns is None:
        columns = {column.parameter_code: column for column in baseline_snapshot.columns}
        cache.baseline_columns_by_snapshot_id[baseline_snapshot_id] = columns
    return columns


def _prepare_current_condition(
    condition: BackboneDiffCurrentCondition,
    baseline_columns: dict[str, BackboneSnapshotColumn],
    current_descriptor_by_code: dict[str, BackboneDiffCurrentParameter],
) -> _PreparedCurrentCondition:
    canonical_values_by_code: dict[str, str | None] = {}
    payload_cells: list[tuple[str, str | None]] = []
    for cell in condition.cells:
        descriptor = current_descriptor_by_code.get(cell.parameter_code)
        if descriptor is None:
            descriptor = baseline_columns.get(cell.parameter_code)
        if descriptor is None:
            _unresolved_parameter_metadata(
                f"missing current descriptor for parameter {cell.parameter_code}",
                details={"parameter_code": cell.parameter_code, "condition_id": condition.id},
            )
        canonical_value = _canonical_current_value(
            descriptor,
            cell.value,
            cell.parameter_code,
        )
        canonical_values_by_code[cell.parameter_code] = canonical_value
        payload_cells.append((cell.parameter_code, canonical_value))
    return _PreparedCurrentCondition(
        condition=condition,
        canonical_values_by_code=canonical_values_by_code,
        payload_cells=tuple(payload_cells),
    )


def _hash_project_bytes(prepared_layers: tuple[_PreparedLayer, ...]) -> str:
    project_bytes = b"[" + b",".join(prepared.basis_bytes for prepared in prepared_layers) + b"]"
    return _hash_bytes(project_bytes)


def _current_parameter_payload(parameter: BackboneDiffCurrentParameter) -> dict[str, Any]:
    value_type = cast(ValueType, parameter.value_type)
    return {
        "active": parameter.active,
        "category_code": parameter.category_code,
        "code": parameter.code,
        "display_name": parameter.display_name,
        "sort_order": parameter.sort_order,
        "value_type": value_type.value,
    }


def _hash_bytes(payload: bytes) -> str:
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _matched_row(
    layer_key: str,
    baseline_condition: Any,
    current_condition: BackboneDiffCurrentCondition,
    baseline_cells_by_code: Mapping[str, str | None],
    current_prepared: _PreparedCurrentCondition,
    prepared: _PreparedLayer,
) -> BackboneDiffRow:
    metadata_changes = tuple(_metadata_changes(baseline_condition, current_condition))
    cell_changes = tuple(
        _compare_coordinate(
            parameter_code,
            baseline_cells_by_code,
            current_prepared,
            prepared,
        )
        for parameter_code in prepared.coordinate_codes
    )
    return BackboneDiffRow(
        layer_key=layer_key,
        row_status=ROW_STATUS_MATCHED,
        effective_condition_index=current_condition.condition_index,
        identity=current_condition.id,
        baseline_source_condition_id=baseline_condition.source_condition_id,
        current_id=current_condition.id,
        baseline_condition_index=baseline_condition.condition_index,
        current_condition_index=current_condition.condition_index,
        baseline_label=baseline_condition.label,
        current_label=current_condition.label,
        baseline_is_por=baseline_condition.is_por,
        current_is_por=current_condition.is_por,
        metadata_changes=metadata_changes,
        cell_changes=cell_changes,
    )


def _added_row(
    layer_key: str,
    current_condition: BackboneDiffCurrentCondition,
    current_prepared: _PreparedCurrentCondition,
    prepared: _PreparedLayer,
) -> BackboneDiffRow:
    cell_changes = tuple(
        BackboneDiffCellChange(
            parameter_code=parameter_code,
            sort_order=prepared.coordinate_plan[parameter_code].sort_order,
            classification=CLASSIFICATION_ADDED,
            reason="row_added",
            baseline_value=None,
            current_value=current_prepared.canonical_values_by_code.get(parameter_code),
        )
        for parameter_code in prepared.added_row_codes
    )
    return BackboneDiffRow(
        layer_key=layer_key,
        row_status=ROW_STATUS_ADDED,
        effective_condition_index=current_condition.condition_index,
        identity=current_condition.id,
        baseline_source_condition_id=current_condition.source_condition_id,
        current_id=current_condition.id,
        baseline_condition_index=None,
        current_condition_index=current_condition.condition_index,
        baseline_label=None,
        current_label=current_condition.label,
        baseline_is_por=None,
        current_is_por=current_condition.is_por,
        metadata_changes=(),
        cell_changes=cell_changes,
    )


def _removed_row(
    layer_key: str,
    baseline_condition: Any,
    baseline_cells_by_code: Mapping[str, str | None],
    prepared: _PreparedLayer,
) -> BackboneDiffRow:
    cell_changes = tuple(
        BackboneDiffCellChange(
            parameter_code=parameter_code,
            sort_order=prepared.coordinate_plan[parameter_code].sort_order,
            classification=CLASSIFICATION_REMOVED,
            reason="row_removed",
            baseline_value=baseline_cells_by_code.get(parameter_code),
            current_value=None,
        )
        for parameter_code in prepared.removed_row_codes
    )
    return BackboneDiffRow(
        layer_key=layer_key,
        row_status=ROW_STATUS_REMOVED,
        effective_condition_index=baseline_condition.condition_index,
        identity=baseline_condition.source_condition_id,
        baseline_source_condition_id=baseline_condition.source_condition_id,
        current_id=None,
        baseline_condition_index=baseline_condition.condition_index,
        current_condition_index=None,
        baseline_label=baseline_condition.label,
        current_label=None,
        baseline_is_por=baseline_condition.is_por,
        current_is_por=None,
        metadata_changes=(),
        cell_changes=cell_changes,
    )


def _metadata_changes(
    baseline_condition: Any,
    current_condition: BackboneDiffCurrentCondition,
) -> list[BackboneDiffMetadataChange]:
    changes: list[BackboneDiffMetadataChange] = []
    if baseline_condition.label != current_condition.label:
        changes.append(
            BackboneDiffMetadataChange("label", baseline_condition.label, current_condition.label)
        )
    if baseline_condition.condition_index != current_condition.condition_index:
        changes.append(
            BackboneDiffMetadataChange(
                "condition_index",
                baseline_condition.condition_index,
                current_condition.condition_index,
            )
        )
    if baseline_condition.is_por != current_condition.is_por:
        changes.append(
            BackboneDiffMetadataChange(
                "is_por", baseline_condition.is_por, current_condition.is_por
            )
        )
    return sorted(changes, key=lambda change: METADATA_FIELD_ORDER[change.field_name])


def _compare_coordinate(
    parameter_code: str,
    baseline_cells_by_code: Mapping[str, str | None],
    current_prepared: _PreparedCurrentCondition,
    prepared: _PreparedLayer,
) -> BackboneDiffCellChange:
    coordinate = prepared.coordinate_plan[parameter_code]
    baseline_has_column = coordinate.baseline_has_column
    current_has_column = coordinate.current_has_column

    if baseline_has_column and not current_has_column:
        return BackboneDiffCellChange(
            parameter_code=parameter_code,
            sort_order=coordinate.sort_order,
            classification=CLASSIFICATION_REMOVED,
            reason="column_removed",
            baseline_value=baseline_cells_by_code.get(parameter_code),
            current_value=None,
        )
    if current_has_column and not baseline_has_column:
        return BackboneDiffCellChange(
            parameter_code=parameter_code,
            sort_order=coordinate.sort_order,
            classification=CLASSIFICATION_ADDED,
            reason="column_added",
            baseline_value=None,
            current_value=current_prepared.canonical_values_by_code.get(parameter_code),
        )

    baseline_value = baseline_cells_by_code.get(parameter_code)
    current_value = current_prepared.canonical_values_by_code.get(parameter_code)

    if baseline_value is None and current_value is None:
        return BackboneDiffCellChange(
            parameter_code=parameter_code,
            sort_order=coordinate.sort_order,
            classification=CLASSIFICATION_UNCHANGED,
            reason="null_equal",
            baseline_value=None,
            current_value=None,
        )
    if baseline_value is None and current_value is not None:
        return BackboneDiffCellChange(
            parameter_code=parameter_code,
            sort_order=coordinate.sort_order,
            classification=CLASSIFICATION_ADDED,
            reason="value_added",
            baseline_value=None,
            current_value=current_value,
        )
    if baseline_value is not None and current_value is None:
        return BackboneDiffCellChange(
            parameter_code=parameter_code,
            sort_order=coordinate.sort_order,
            classification=CLASSIFICATION_CLEARED,
            reason="value_cleared",
            baseline_value=baseline_value,
            current_value=None,
        )
    if baseline_value == current_value:
        return BackboneDiffCellChange(
            parameter_code=parameter_code,
            sort_order=coordinate.sort_order,
            classification=CLASSIFICATION_UNCHANGED,
            reason="value_equal",
            baseline_value=baseline_value,
            current_value=current_value,
        )
    return BackboneDiffCellChange(
        parameter_code=parameter_code,
        sort_order=coordinate.sort_order,
        classification=CLASSIFICATION_CHANGED,
        reason="value_changed",
        baseline_value=baseline_value,
        current_value=current_value,
    )


def _row_preview_items(
    layer_sort_order: int, row: BackboneDiffRow
) -> list[BackboneDiffPreviewItem]:
    items: list[BackboneDiffPreviewItem] = []
    for change in row.metadata_changes:
        items.append(
            BackboneDiffPreviewItem(
                layer_key=row.layer_key,
                layer_sort_order=layer_sort_order,
                effective_condition_index=row.effective_condition_index,
                row_status=row.row_status,
                identity=row.identity,
                item_kind=ITEM_KIND_ROW_METADATA,
                item_sort_key=(change.field_name,),
                classification=CLASSIFICATION_CHANGED,
                reason="row_metadata_changed",
                field_name=change.field_name,
                baseline_value=_stringify_value(change.baseline_value),
                current_value=_stringify_value(change.current_value),
            )
        )
    for change in row.cell_changes:
        items.append(
            BackboneDiffPreviewItem(
                layer_key=row.layer_key,
                layer_sort_order=layer_sort_order,
                effective_condition_index=row.effective_condition_index,
                row_status=row.row_status,
                identity=row.identity,
                item_kind=ITEM_KIND_CELL,
                item_sort_key=(change.sort_order, change.parameter_code),
                classification=change.classification,
                reason=change.reason,
                parameter_code=change.parameter_code,
                baseline_value=change.baseline_value,
                current_value=change.current_value,
            )
        )
    return items


def _preview_item_sort_key(item: BackboneDiffPreviewItem) -> tuple[Any, ...]:
    return (
        item.layer_sort_order,
        item.layer_key,
        item.effective_condition_index,
        STATUS_RANK[item.row_status],
        item.identity,
        ITEM_KIND_RANK[item.item_kind],
        item.item_sort_key,
    )


def _row_sort_key(row: BackboneDiffRow) -> tuple[Any, ...]:
    return (row.effective_condition_index, STATUS_RANK[row.row_status], row.identity)


def _layer_input_sort_key(layer_input: BackboneDiffLayerInput) -> tuple[Any, ...]:
    return (layer_input.layer_sort_order, layer_input.layer_key)


def _source_payload(source: BackboneDiffCurrentLayerSource) -> dict[str, Any]:
    return {
        "project_id": source.project_id,
        "sheet_layer_id": source.sheet_layer_id,
        "layer_key": source.layer_key,
        "step_seq": source.step_seq,
        "layer_id": source.layer_id,
        "sort_order": source.sort_order,
        "source_project_id": source.source_project_id,
        "source_layer_key": source.source_layer_key,
    }


def _ensure_parameter_type_match(
    parameter_code: str,
    baseline_column: BackboneSnapshotColumn,
    current_descriptor: BackboneDiffCurrentParameter,
) -> None:
    baseline_type = cast(ValueType, baseline_column.value_type)
    current_type = cast(ValueType, current_descriptor.value_type)
    if baseline_type is not current_type:
        _diff_basis_invalid(
            f"type mismatch for parameter {parameter_code}: "
            f"{baseline_type.value} vs {current_type.value}",
            details={
                "parameter_code": parameter_code,
                "baseline_value_type": baseline_type.value,
                "current_value_type": current_type.value,
            },
        )


def _require_text(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or value == "":
        _diff_basis_invalid(f"{field_name} must be a non-empty string")
    return value


def _require_bool(value: Any, field_name: str) -> bool:
    if not isinstance(value, bool):
        _diff_basis_invalid(f"{field_name} must be a boolean")
    return value


def _require_int(value: Any, field_name: str, *, non_negative: bool) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        _diff_basis_invalid(f"{field_name} must be an integer")
    if non_negative and value < 0:
        _diff_basis_invalid(f"{field_name} must be non-negative")
    if not non_negative and value <= 0:
        _diff_basis_invalid(f"{field_name} must be positive")
    return value


def _require_positive_int(value: Any, field_name: str) -> int:
    return _require_int(value, field_name, non_negative=False)


def _require_non_negative_int(value: Any, field_name: str) -> int:
    return _require_int(value, field_name, non_negative=True)


def _coerce_value_type(value_type: ValueType | str) -> ValueType:
    try:
        return value_type if isinstance(value_type, ValueType) else ValueType(value_type)
    except Exception as exc:  # pragma: no cover - ValueType raises ValueError on invalid input
        _diff_basis_invalid(f"invalid value_type: {value_type}")
        raise AssertionError from exc


def _current_condition_sort_key(condition: BackboneDiffCurrentCondition) -> tuple[int, int]:
    return (condition.condition_index, condition.id)


def _current_parameter_sort_key(parameter: BackboneDiffCurrentParameter) -> tuple[int, str]:
    return (parameter.sort_order, parameter.code)


def _descriptor_for_code(
    current_condition: BackboneDiffCurrentCondition,
    parameter_code: str,
    baseline_columns: dict[str, BackboneSnapshotColumn],
    current_descriptor_by_code: dict[str, BackboneDiffCurrentParameter],
) -> BackboneDiffCurrentParameter | BackboneSnapshotColumn:
    current_descriptor = current_descriptor_by_code.get(parameter_code)
    baseline_column = baseline_columns.get(parameter_code)
    if current_descriptor is not None:
        if baseline_column is not None:
            _ensure_parameter_type_match(parameter_code, baseline_column, current_descriptor)
        return current_descriptor
    if baseline_column is not None:
        return baseline_column
    _unresolved_parameter_metadata(
        "missing current descriptor for parameter "
        f"{parameter_code} in condition {current_condition.id}",
        details={"parameter_code": parameter_code, "condition_id": current_condition.id},
    )


def _descriptor_for_added_or_removed_code(
    parameter_code: str,
    baseline_columns: dict[str, BackboneSnapshotColumn],
    current_descriptor_by_code: dict[str, BackboneDiffCurrentParameter],
) -> BackboneDiffCurrentParameter | BackboneSnapshotColumn:
    current_descriptor = current_descriptor_by_code.get(parameter_code)
    if current_descriptor is not None:
        baseline_column = baseline_columns.get(parameter_code)
        if baseline_column is not None:
            _ensure_parameter_type_match(parameter_code, baseline_column, current_descriptor)
        return current_descriptor
    baseline_column = baseline_columns.get(parameter_code)
    if baseline_column is not None:
        return baseline_column
    _unresolved_parameter_metadata(
        f"missing descriptor for parameter {parameter_code}",
        details={"parameter_code": parameter_code},
    )


def _selected_current_descriptors(
    layer_input: BackboneDiffLayerInput,
    cache: _PrepareCache,
) -> tuple[BackboneDiffCurrentParameter, ...]:
    parameters_key = layer_input.current_parameters
    stored_codes = frozenset(
        cell.parameter_code
        for condition in layer_input.current_conditions
        for cell in condition.cells
    )
    universe_key = (parameters_key, stored_codes)
    cached = cache.current_selected_by_universe_key.get(universe_key)
    if cached is not None:
        return cached
    parameter_by_code = {parameter.code: parameter for parameter in layer_input.current_parameters}
    selected_codes = {
        parameter.code for parameter in layer_input.current_parameters if parameter.active
    }
    selected_codes.update(stored_codes)
    selected: list[BackboneDiffCurrentParameter] = []
    for code in sorted(selected_codes):
        parameter = parameter_by_code.get(code)
        if parameter is None:
            _unresolved_parameter_metadata(
                f"missing current descriptor for parameter {code}",
                details={"parameter_code": code},
            )
        selected.append(parameter)
    selected_tuple = tuple(sorted(selected, key=_current_parameter_sort_key))
    cache.current_selected_by_universe_key[universe_key] = selected_tuple
    return selected_tuple


def _validate_parameter_type_compatibility(
    baseline_columns: dict[str, BackboneSnapshotColumn],
    current_descriptor_by_code: dict[str, BackboneDiffCurrentParameter],
) -> None:
    for parameter_code in sorted(baseline_columns.keys() & current_descriptor_by_code.keys()):
        _ensure_parameter_type_match(
            parameter_code,
            baseline_columns[parameter_code],
            current_descriptor_by_code[parameter_code],
        )


def _ordered_coordinate_codes(
    baseline_columns: dict[str, BackboneSnapshotColumn],
    current_descriptor_by_code: dict[str, BackboneDiffCurrentParameter],
    baseline_universe: set[str],
    current_universe: set[str],
) -> list[str]:
    codes = sorted(baseline_universe | current_universe)
    codes.sort(
        key=lambda code: (
            _descriptor_sort_key(current_descriptor_by_code.get(code) or baseline_columns[code]),
            code,
        )
    )
    return codes


def _ordered_added_row_codes(
    baseline_columns: dict[str, BackboneSnapshotColumn],
    current_descriptor_by_code: dict[str, BackboneDiffCurrentParameter],
    current_universe: set[str],
) -> list[str]:
    codes = sorted(current_universe)
    codes.sort(
        key=lambda code: (
            _descriptor_sort_key(current_descriptor_by_code.get(code) or baseline_columns[code]),
            code,
        )
    )
    return codes


def _ordered_baseline_row_codes(
    baseline_columns: dict[str, BackboneSnapshotColumn],
    baseline_universe: set[str],
) -> list[str]:
    codes = sorted(baseline_universe)
    codes.sort(key=lambda code: (_descriptor_sort_key(baseline_columns[code]), code))
    return codes


def _stringify_value(value: Any) -> str:
    return "" if value is None else str(value)


def _canonical_current_value(
    descriptor: BackboneDiffCurrentParameter | BackboneSnapshotColumn,
    value: str | None,
    parameter_code: str,
) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        _diff_basis_invalid(f"current cell value for {parameter_code} must be a string or null")
    value_type = _coerce_value_type(descriptor.value_type)
    if value_type is ValueType.NUMBER:
        try:
            return normalize_decimal(value)
        except RuleViolationError as exc:
            _diff_basis_invalid(f"invalid number for {parameter_code}: {exc.code}")
    if value_type is ValueType.CHOICE:
        if value == "":
            _diff_basis_invalid(f"choice value must not be empty for {parameter_code}")
        return value
    return value


def _descriptor_sort_key(
    descriptor: BackboneDiffCurrentParameter | BackboneSnapshotColumn,
) -> tuple[int, str]:
    return (
        descriptor.sort_order,
        descriptor.code
        if isinstance(descriptor, BackboneDiffCurrentParameter)
        else descriptor.parameter_code,
    )
