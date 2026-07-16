"""Pure, frozen projections for Phase 4 History responses.

This module intentionally stays framework- and repository-free. It accepts
minimal frozen row objects that resemble repository output and projects them
into JSON-serializable DTOs without exposing raw payload blobs.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from types import MappingProxyType
from typing import Any

from app.core.errors import ConflictError
from app.domain.backbone.snapshot import serialize_backbone_snapshot
from app.domain.errors import RuleViolationError

__all__ = [
    "HistoryAvailability",
    "HistoryEntryRole",
    "HistoryEventRow",
    "HistoryJumpState",
    "HistoryJumpProjection",
    "HistoryTimelineMetadata",
    "HistoryTimelineItem",
    "HistoryTimelineProjection",
    "HistoryCellDetailItem",
    "HistoryCellDetailProjection",
    "BackboneCaptureItem",
    "BackboneCaptureProjection",
    "HistoryCellHistoryEntry",
    "HistoryCellHistoryProjection",
    "project_backbone_capture",
    "project_cell_detail",
    "project_cell_history",
    "project_jump_state",
    "project_timeline_summary",
]


class HistoryAvailability(StrEnum):
    """High-level projection availability."""

    AVAILABLE = "available"
    LEGACY_UNAVAILABLE = "legacy_unavailable"
    NO_APPLICABLE = "no_applicable"


class HistoryJumpState(StrEnum):
    """Whether a diff item can jump back to a live grid cell."""

    PRESENT = "present"
    DELETED = "deleted"


class HistoryEntryRole(StrEnum):
    """Cell history role within a projected chain."""

    CURRENT = "current"
    BASELINE = "baseline"
    INITIAL = "initial"


@dataclass(frozen=True, slots=True)
class HistoryEventRow:
    """Minimal repository-style row input for history projections."""

    event_id: int
    event_type: str
    actor: str = "system"
    created_at: datetime | None = None
    batch_id: str | None = None
    origin: str | None = None
    layer_key: str | None = None
    layer_sort_order: int | None = None
    condition_id: int | None = None
    condition_index: int | None = None
    source_condition_id: int | None = None
    source_condition_index: int | None = None
    parameter_code: str | None = None
    parameter_sort_order: int | None = None
    old_value: str | None = None
    new_value: str | None = None
    source_project_id: int | None = None
    source_layer_key: str | None = None
    schema_version: int = 2
    history_role: HistoryEntryRole = HistoryEntryRole.CURRENT
    deleted: bool = False
    detail: Any = field(default_factory=dict)
    capture: Any = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "detail", _freeze_payload(self.detail))
        object.__setattr__(self, "capture", _freeze_payload(self.capture))


@dataclass(frozen=True, slots=True)
class HistoryJumpProjection:
    state: HistoryJumpState
    event_id: int | None
    condition_id: int | None
    parameter_code: str | None
    layer_key: str | None

    @property
    def present(self) -> bool:
        return self.state is HistoryJumpState.PRESENT


@dataclass(frozen=True, slots=True)
class HistoryTimelineMetadata:
    total_items: int
    cell_items: int
    capture_items: int
    legacy_items: int


@dataclass(frozen=True, slots=True)
class HistoryTimelineItem:
    event_id: int
    event_type: str
    actor: str
    created_at: str | None
    batch_id: str | None
    origin: str | None
    layer_key: str | None
    source_project_id: int | None
    source_layer_key: str | None
    condition_id: int | None
    parameter_code: str | None
    detail_applicability: HistoryAvailability
    legacy_coverage: HistoryAvailability
    jump_state: HistoryJumpState


@dataclass(frozen=True, slots=True)
class HistoryTimelineProjection:
    metadata: HistoryTimelineMetadata
    detail_applicability: HistoryAvailability
    legacy_coverage: HistoryAvailability
    items: tuple[HistoryTimelineItem, ...]

    @property
    def detail_applicable(self) -> bool:
        return self.detail_applicability is HistoryAvailability.AVAILABLE


@dataclass(frozen=True, slots=True)
class HistoryCellDetailItem:
    event_id: int
    actor: str
    created_at: str | None
    layer_key: str | None
    condition_id: int | None
    parameter_code: str | None
    old_value: str | None
    new_value: str | None
    source_project_id: int | None
    source_layer_key: str | None
    jump_state: HistoryJumpState


@dataclass(frozen=True, slots=True)
class HistoryCellDetailProjection:
    availability: HistoryAvailability
    items: tuple[HistoryCellDetailItem, ...]

    @property
    def detail_applicable(self) -> bool:
        return self.availability is HistoryAvailability.AVAILABLE


@dataclass(frozen=True, slots=True)
class BackboneCaptureItem:
    target_layer_sort: int
    layer_key: str
    target_condition_id: int
    source_condition_index: int
    source_condition_id: int
    parameter_sort: int
    parameter_code: str
    value: str
    jump_state: HistoryJumpState
    event_id: int

    @property
    def target_layer_key(self) -> str:
        return self.layer_key

    @property
    def copied_value(self) -> str:
        return self.value

    @property
    def deleted(self) -> bool:
        return self.jump_state is HistoryJumpState.DELETED


@dataclass(frozen=True, slots=True)
class BackboneCaptureProjection:
    availability: HistoryAvailability
    items: tuple[BackboneCaptureItem, ...]

    @property
    def detail_applicable(self) -> bool:
        return self.availability is HistoryAvailability.AVAILABLE


@dataclass(frozen=True, slots=True)
class HistoryCellHistoryEntry:
    role: HistoryEntryRole
    event_id: int
    actor: str
    created_at: str | None
    layer_key: str | None
    condition_id: int | None
    parameter_code: str | None
    old_value: str | None
    new_value: str | None
    source_project_id: int | None
    source_layer_key: str | None
    jump_state: HistoryJumpState

    @property
    def deleted(self) -> bool:
        return self.jump_state is HistoryJumpState.DELETED


@dataclass(frozen=True, slots=True)
class HistoryCellHistoryProjection:
    entries: tuple[HistoryCellHistoryEntry, ...]
    baseline_entry: HistoryCellHistoryEntry | None
    initial_entry: HistoryCellHistoryEntry | None
    initial_state: HistoryAvailability

    @property
    def initial_state_unavailable(self) -> bool:
        return self.initial_state is not HistoryAvailability.AVAILABLE


_CELL_EVENT_TYPES = {"cell_update"}
_CAPTURE_EVENT_TYPES = {"project_create", "backbone_copy", "backbone_layer_replace"}
_SUPPORTED_DETAIL_EVENT_TYPES = _CELL_EVENT_TYPES | _CAPTURE_EVENT_TYPES


def _format_timestamp(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _freeze_payload(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({key: _freeze_payload(item) for key, item in value.items()})
    if isinstance(value, list | tuple):
        return tuple(_freeze_payload(item) for item in value)
    return value


def _row_kind(row: HistoryEventRow) -> str:
    if row.event_type in _CELL_EVENT_TYPES:
        return "cell"
    if row.event_type in _CAPTURE_EVENT_TYPES:
        return "capture"
    return "other"


def _detail_availability(rows: Sequence[HistoryEventRow]) -> HistoryAvailability:
    relevant = [row for row in rows if _row_kind(row) != "other"]
    if not relevant:
        return HistoryAvailability.NO_APPLICABLE
    if any(row.schema_version != 1 for row in relevant):
        return HistoryAvailability.AVAILABLE
    return HistoryAvailability.LEGACY_UNAVAILABLE


def _legacy_coverage(rows: Sequence[HistoryEventRow]) -> HistoryAvailability:
    relevant = [row for row in rows if _row_kind(row) != "other"]
    if not relevant:
        return HistoryAvailability.NO_APPLICABLE
    if any(row.schema_version == 1 for row in relevant):
        return HistoryAvailability.LEGACY_UNAVAILABLE
    return HistoryAvailability.AVAILABLE


@dataclass(frozen=True, slots=True)
class _BackboneCaptureDetail:
    target_condition_id: int
    source_condition_id: int
    label: str
    condition_index: int
    is_por: bool
    cell_count: int


def _jump_state(row: HistoryEventRow | None) -> HistoryJumpProjection:
    if row is None:
        return HistoryJumpProjection(
            state=HistoryJumpState.DELETED,
            event_id=None,
            condition_id=None,
            parameter_code=None,
            layer_key=None,
        )
    present = not row.deleted and row.condition_id is not None and row.parameter_code is not None
    return HistoryJumpProjection(
        state=HistoryJumpState.PRESENT if present else HistoryJumpState.DELETED,
        event_id=row.event_id,
        condition_id=row.condition_id,
        parameter_code=row.parameter_code,
        layer_key=row.layer_key,
    )


def project_jump_state(row: HistoryEventRow | None) -> HistoryJumpProjection:
    """Project a live-grid jump target state."""

    return _jump_state(row)


def project_timeline_summary(rows: Sequence[HistoryEventRow]) -> HistoryTimelineProjection:
    """Project timeline summary metadata and detail availability.

    The projection is deterministic: newest event first, with stable field
    selection and no raw payload passthrough.
    """

    ordered_rows = tuple(sorted(rows, key=lambda row: row.event_id, reverse=True))
    detail_applicability = _detail_availability(ordered_rows)
    legacy_coverage = _legacy_coverage(ordered_rows)
    items = tuple(_project_timeline_item(row) for row in ordered_rows)
    metadata = HistoryTimelineMetadata(
        total_items=len(ordered_rows),
        cell_items=sum(_row_kind(row) == "cell" for row in ordered_rows),
        capture_items=sum(_row_kind(row) == "capture" for row in ordered_rows),
        legacy_items=sum(row.schema_version == 1 for row in ordered_rows),
    )
    return HistoryTimelineProjection(
        metadata=metadata,
        detail_applicability=detail_applicability,
        legacy_coverage=legacy_coverage,
        items=items,
    )


def _project_timeline_item(row: HistoryEventRow) -> HistoryTimelineItem:
    jump = _jump_state(row)
    detail_applicability = (
        HistoryAvailability.AVAILABLE
        if _row_kind(row) != "other" and row.schema_version != 1
        else (
            HistoryAvailability.LEGACY_UNAVAILABLE
            if _row_kind(row) != "other"
            else HistoryAvailability.NO_APPLICABLE
        )
    )
    legacy_coverage = (
        HistoryAvailability.LEGACY_UNAVAILABLE
        if row.schema_version == 1 and _row_kind(row) != "other"
        else (
            HistoryAvailability.AVAILABLE
            if _row_kind(row) != "other"
            else HistoryAvailability.NO_APPLICABLE
        )
    )
    return HistoryTimelineItem(
        event_id=row.event_id,
        event_type=row.event_type,
        actor=row.actor,
        created_at=_format_timestamp(row.created_at),
        batch_id=row.batch_id,
        origin=row.origin,
        layer_key=row.layer_key,
        source_project_id=row.source_project_id,
        source_layer_key=row.source_layer_key,
        condition_id=row.condition_id,
        parameter_code=row.parameter_code,
        detail_applicability=detail_applicability,
        legacy_coverage=legacy_coverage,
        jump_state=jump.state,
    )


def project_cell_detail(rows: Sequence[HistoryEventRow]) -> HistoryCellDetailProjection:
    """Project cell detail DTOs in descending event id order."""

    ordered_rows = tuple(sorted(rows, key=lambda row: row.event_id, reverse=True))
    availability = _detail_availability(ordered_rows)
    items = tuple(_project_cell_detail_item(row) for row in ordered_rows)
    return HistoryCellDetailProjection(availability=availability, items=items)


def _project_cell_detail_item(row: HistoryEventRow) -> HistoryCellDetailItem:
    jump = _jump_state(row)
    return HistoryCellDetailItem(
        event_id=row.event_id,
        actor=row.actor,
        created_at=_format_timestamp(row.created_at),
        layer_key=row.layer_key,
        condition_id=row.condition_id,
        parameter_code=row.parameter_code,
        old_value=row.old_value,
        new_value=row.new_value,
        source_project_id=row.source_project_id,
        source_layer_key=row.source_layer_key,
        jump_state=jump.state,
    )


def _capture_items_from_row(row: HistoryEventRow) -> tuple[BackboneCaptureItem, ...]:
    if row.schema_version == 1:
        raise ValueError("legacy capture row")
    snapshot = serialize_backbone_snapshot(row.capture)
    detail_by_source = _capture_detail_by_source(row.detail)
    columns_by_code = {column["parameter_code"]: column for column in snapshot["columns"]}
    expected_sources = {
        condition["source_condition_id"] for condition in snapshot["conditions"]
    }
    if expected_sources != set(detail_by_source):
        raise ValueError("capture detail does not match snapshot conditions")

    items: list[BackboneCaptureItem] = []
    for condition in snapshot["conditions"]:
        condition_detail = detail_by_source[condition["source_condition_id"]]
        _validate_capture_condition(condition, condition_detail)
        cells = condition["cells"]
        cell_items = tuple(
            sorted(
                (
                    (
                        _require_int(columns_by_code[parameter_code]["sort_order"], "sort_order"),
                        parameter_code,
                        value,
                    )
                    for parameter_code, value in cells.items()
                    if value is not None
                ),
                key=lambda item: (item[0], item[1]),
            )
        )
        for parameter_sort, parameter_code, value in cell_items:
            jump_state = (
                HistoryJumpState.DELETED if row.deleted else HistoryJumpState.PRESENT
            )
            items.append(
                BackboneCaptureItem(
                    target_layer_sort=_require_int(row.layer_sort_order, "layer_sort_order"),
                    layer_key=_require_str(row.layer_key, "layer_key"),
                    target_condition_id=condition_detail.target_condition_id,
                    source_condition_index=_require_int(
                        condition["condition_index"], "condition_index"
                    ),
                    source_condition_id=_require_int(
                        condition["source_condition_id"], "source_condition_id"
                    ),
                    parameter_sort=parameter_sort,
                    parameter_code=parameter_code,
                    value=value if isinstance(value, str) else (_raise_capture_value_error()),
                    jump_state=jump_state,
                    event_id=row.event_id,
                )
            )
    return tuple(items)


def _capture_detail_by_source(raw: Any) -> dict[int, _BackboneCaptureDetail]:
    items = _require_sequence(raw, "detail")
    parsed: dict[int, _BackboneCaptureDetail] = {}
    for item in items:
        mapping = _require_mapping(item, "detail item")
        _require_exact_keys(
            mapping,
            {
                "target_condition_id",
                "source_condition_id",
                "label",
                "condition_index",
                "is_por",
                "cell_count",
            },
            "detail item",
        )
        detail = _BackboneCaptureDetail(
            target_condition_id=_require_int(
                mapping["target_condition_id"], "target_condition_id"
            ),
            source_condition_id=_require_int(
                mapping["source_condition_id"], "source_condition_id"
            ),
            label=_require_str(mapping["label"], "label"),
            condition_index=_require_int(mapping["condition_index"], "condition_index"),
            is_por=_require_bool(mapping["is_por"], "is_por"),
            cell_count=_require_int(mapping["cell_count"], "cell_count"),
        )
        if detail.source_condition_id in parsed:
            raise ValueError("duplicate source_condition_id in capture detail")
        parsed[detail.source_condition_id] = detail
    return parsed


def _validate_capture_condition(
    condition: Mapping[str, Any], detail: _BackboneCaptureDetail
) -> None:
    if (
        _require_int(condition["source_condition_id"], "source_condition_id")
        != detail.source_condition_id
    ):
        raise ValueError("capture detail source mismatch")
    if _require_str(condition["label"], "label") != detail.label:
        raise ValueError("capture detail label mismatch")
    if _require_int(condition["condition_index"], "condition_index") != detail.condition_index:
        raise ValueError("capture detail index mismatch")
    if _require_bool(condition["is_por"], "is_por") != detail.is_por:
        raise ValueError("capture detail POR mismatch")
    if len(condition["cells"]) != detail.cell_count:
        raise ValueError("capture detail cell_count mismatch")


def _raise_capture_value_error() -> Any:
    raise ValueError("capture cell value must be a string")


def project_backbone_capture(rows: Sequence[HistoryEventRow]) -> BackboneCaptureProjection:
    """Project v2 backbone capture rows.

    The capture batch must stay pure: mixed cell/capture rows are a conflict,
    v1 batches are legacy-unavailable, and the flattened sort is exact.
    """

    ordered_rows = tuple(rows)
    _reject_mixed_cell_and_capture_rows(ordered_rows)
    capture_rows = tuple(row for row in ordered_rows if _row_kind(row) == "capture")
    if not capture_rows:
        return BackboneCaptureProjection(
            availability=HistoryAvailability.NO_APPLICABLE,
            items=(),
        )
    try:
        items = tuple(
            item
            for row in capture_rows
            for item in _capture_items_from_row(row)
        )
    except (ConflictError, RuleViolationError, ValueError, TypeError, KeyError):
        return BackboneCaptureProjection(
            availability=HistoryAvailability.LEGACY_UNAVAILABLE,
            items=(),
        )
    if not items:
        return BackboneCaptureProjection(
            availability=HistoryAvailability.NO_APPLICABLE,
            items=(),
        )
    return BackboneCaptureProjection(
        availability=HistoryAvailability.AVAILABLE,
        items=tuple(
            sorted(
                items,
                key=lambda item: (
                    item.target_layer_sort,
                    item.layer_key,
                    item.source_condition_index,
                    item.source_condition_id,
                    item.parameter_sort,
                    item.parameter_code,
                    item.event_id,
                ),
            )
        ),
    )


def _reject_mixed_cell_and_capture_rows(rows: Sequence[HistoryEventRow]) -> None:
    has_cell = any(_row_kind(row) == "cell" for row in rows)
    has_capture = any(_row_kind(row) == "capture" for row in rows)
    if has_cell and has_capture:
        raise ConflictError(
            "혼합된 cell/capture 배치는 처리할 수 없다",
            code="invalid_event_batch",
        )


def project_cell_history(
    rows: Sequence[HistoryEventRow], *, initial_state_unavailable: bool = False
) -> HistoryCellHistoryProjection:
    """Project newest-first cell history plus baseline/initial anchors."""

    ordered_rows = tuple(sorted(rows, key=lambda row: row.event_id, reverse=True))
    current_rows = tuple(
        row for row in ordered_rows if row.history_role is HistoryEntryRole.CURRENT
    )
    baseline_rows = tuple(
        row for row in ordered_rows if row.history_role is HistoryEntryRole.BASELINE
    )
    initial_rows = tuple(
        row for row in ordered_rows if row.history_role is HistoryEntryRole.INITIAL
    )
    entries = tuple(_project_cell_history_entry(row) for row in current_rows)
    baseline_entry = _project_cell_history_entry(baseline_rows[0]) if baseline_rows else None
    initial_entry = _project_cell_history_entry(initial_rows[0]) if initial_rows else None
    return HistoryCellHistoryProjection(
        entries=entries,
        baseline_entry=baseline_entry,
        initial_entry=initial_entry,
        initial_state=(
            HistoryAvailability.AVAILABLE
            if initial_entry is not None
            else HistoryAvailability.LEGACY_UNAVAILABLE
            if initial_state_unavailable
            else HistoryAvailability.NO_APPLICABLE
        ),
    )


def _project_cell_history_entry(row: HistoryEventRow) -> HistoryCellHistoryEntry:
    jump = _jump_state(row)
    return HistoryCellHistoryEntry(
        role=row.history_role,
        event_id=row.event_id,
        actor=row.actor,
        created_at=_format_timestamp(row.created_at),
        layer_key=row.layer_key,
        condition_id=row.condition_id,
        parameter_code=row.parameter_code,
        old_value=row.old_value,
        new_value=row.new_value,
        source_project_id=row.source_project_id,
        source_layer_key=row.source_layer_key,
        jump_state=jump.state,
    )


def _require_int(value: int | None, field_name: str) -> int:
    if value is None:
        raise ValueError(f"{field_name} is required for history projection")
    return value


def _require_str(value: str | None, field_name: str) -> str:
    if value is None:
        raise ValueError(f"{field_name} is required for history projection")
    return value


def _require_sequence(value: Any, field_name: str) -> Sequence[Any]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise ValueError(f"{field_name} must be a sequence")
    return value


def _require_mapping(value: Any, field_name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{field_name} must be a mapping")
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
        raise ValueError(f"{field_name} keys mismatch ({'; '.join(detail)})")


def _require_bool(value: Any, field_name: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field_name} must be a boolean")
    return value
