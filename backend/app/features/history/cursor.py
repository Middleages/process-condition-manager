"""Opaque, versioned cursors and scopes for history queries."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal, NoReturn, Sequence, cast

from app.domain.errors import RuleViolationError
from app.models.project import ChangeEventType

_HISTORY_CURSOR_VERSION = 1
_MAX_TOKEN_LENGTH = 4096

HistoryOrigin = Literal["manual", "paste", "backbone", "system"]
HistoryOrderKind = Literal["event_desc", "capture_asc"]


def _raise_invalid_cursor(message: str) -> NoReturn:
    raise RuleViolationError(message, code="invalid_cursor")


def _raise_invalid_scope(message: str) -> NoReturn:
    raise RuleViolationError(message, code="invalid_scope")


def _is_safe_token_character(character: str) -> bool:
    return character.isascii() and (character.isalnum() or character in "_-")


def _encode_payload(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _fingerprint_payload(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(raw).hexdigest()


def _decode_payload(raw: str, *, error_code: str) -> dict[str, Any]:
    if not isinstance(raw, str) or not raw or len(raw) > _MAX_TOKEN_LENGTH:
        if error_code == "invalid_scope":
            _raise_invalid_scope("history scope token is invalid")
        _raise_invalid_cursor("history cursor token is invalid")
    if any(not _is_safe_token_character(character) for character in raw):
        if error_code == "invalid_scope":
            _raise_invalid_scope("history scope token is invalid")
        _raise_invalid_cursor("history cursor token is invalid")
    try:
        padding = "=" * (-len(raw) % 4)
        decoded = base64.b64decode(raw + padding, altchars=b"-_", validate=True)
        payload = json.loads(decoded)
        if not isinstance(payload, dict):
            raise ValueError
        return payload
    except (binascii.Error, json.JSONDecodeError, TypeError, UnicodeDecodeError, ValueError):
        if error_code == "invalid_scope":
            _raise_invalid_scope("history scope token is invalid")
        _raise_invalid_cursor("history cursor token is invalid")
    raise AssertionError("unreachable")


def _normalize_non_empty_text(
    raw: object,
    *,
    field_name: str,
    max_length: int,
    error_code: str,
) -> str:
    if not isinstance(raw, str):
        if error_code == "invalid_scope":
            _raise_invalid_scope(f"{field_name} must be text")
        _raise_invalid_cursor(f"{field_name} must be text")
    value = cast(str, raw).strip()
    if not value or len(value) > max_length:
        if error_code == "invalid_scope":
            _raise_invalid_scope(f"{field_name} is invalid")
        _raise_invalid_cursor(f"{field_name} is invalid")
    return value


def _normalize_int(raw: object, *, field_name: str, minimum: int = 1, error_code: str) -> int:
    if type(raw) is not int or raw < minimum:
        if error_code == "invalid_scope":
            _raise_invalid_scope(f"{field_name} is invalid")
        _raise_invalid_cursor(f"{field_name} is invalid")
    return cast(int, raw)


def _normalize_optional_int(raw: object, *, field_name: str, minimum: int = 1) -> int | None:
    if raw is None:
        return None
    return _normalize_int(raw, field_name=field_name, minimum=minimum, error_code="invalid_cursor")


def _normalize_sorted_unique_text_tuple(
    raw: object,
    *,
    field_name: str,
    max_length: int,
    error_code: str,
) -> tuple[str, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list | tuple):
        if error_code == "invalid_scope":
            _raise_invalid_scope(f"{field_name} must be a list")
        _raise_invalid_cursor(f"{field_name} must be a list")
    raw_values = cast(Sequence[object], raw)
    values: list[str] = []
    for item in raw_values:
        values.append(
            _normalize_non_empty_text(
                item, field_name=field_name, max_length=max_length, error_code=error_code
            )
        )
    if len(values) != len(set(values)):
        if error_code == "invalid_scope":
            _raise_invalid_scope(f"{field_name} values must be unique")
        _raise_invalid_cursor(f"{field_name} values must be unique")
    return tuple(sorted(values))


def _normalize_sorted_unique_int_tuple(
    raw: object, *, field_name: str, error_code: str
) -> tuple[int, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list | tuple):
        if error_code == "invalid_scope":
            _raise_invalid_scope(f"{field_name} must be a list")
        _raise_invalid_cursor(f"{field_name} must be a list")
    raw_values = cast(Sequence[object], raw)
    values: list[int] = []
    for item in raw_values:
        values.append(_normalize_int(item, field_name=field_name, error_code=error_code))
    if len(values) != len(set(values)):
        if error_code == "invalid_scope":
            _raise_invalid_scope(f"{field_name} values must be unique")
        _raise_invalid_cursor(f"{field_name} values must be unique")
    return tuple(sorted(values))


def _normalize_datetime(raw: object, *, field_name: str, error_code: str) -> datetime | None:
    if raw is None:
        return None
    parsed: datetime | None = None
    if isinstance(raw, datetime):
        parsed = raw
    elif isinstance(raw, str):
        normalized = raw.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            if error_code == "invalid_scope":
                _raise_invalid_scope(f"{field_name} is invalid")
            _raise_invalid_cursor(f"{field_name} is invalid")
    else:
        if error_code == "invalid_scope":
            _raise_invalid_scope(f"{field_name} must be an ISO datetime string")
        _raise_invalid_cursor(f"{field_name} must be an ISO datetime string")
    assert parsed is not None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    else:
        parsed = parsed.astimezone(UTC)
    return parsed


def _format_datetime(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = _normalize_datetime(value, field_name="datetime", error_code="invalid_scope")
    assert value is not None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True, slots=True)
class HistoryMemberFilterScope:
    layer_keys: tuple[str, ...] = field(default_factory=tuple)
    event_types: tuple[str, ...] = field(default_factory=tuple)
    actors: tuple[str, ...] = field(default_factory=tuple)
    origins: tuple[HistoryOrigin, ...] = field(default_factory=tuple)
    source_project_ids: tuple[int, ...] = field(default_factory=tuple)
    created_from: datetime | str | None = None
    created_to: datetime | str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "layer_keys",
            _normalize_sorted_unique_text_tuple(
                self.layer_keys,
                field_name="layer_keys",
                max_length=256,
                error_code="invalid_scope",
            ),
        )
        object.__setattr__(
            self,
            "event_types",
            _normalize_sorted_unique_event_type_tuple(
                self.event_types, field_name="event_types", error_code="invalid_scope"
            ),
        )
        object.__setattr__(
            self,
            "actors",
            _normalize_sorted_unique_text_tuple(
                self.actors, field_name="actors", max_length=128, error_code="invalid_scope"
            ),
        )
        origins = cast(
            tuple[HistoryOrigin, ...],
            _normalize_sorted_unique_text_tuple(
                self.origins, field_name="origins", max_length=32, error_code="invalid_scope"
            ),
        )
        allowed_origins = {"manual", "paste", "backbone", "system"}
        if any(origin not in allowed_origins for origin in origins):
            _raise_invalid_scope("origins contains an unsupported value")
        object.__setattr__(self, "origins", origins)
        object.__setattr__(
            self,
            "source_project_ids",
            _normalize_sorted_unique_int_tuple(
                self.source_project_ids, field_name="source_project_ids", error_code="invalid_scope"
            ),
        )
        created_from = _normalize_datetime(
            self.created_from, field_name="created_from", error_code="invalid_scope"
        )
        created_to = _normalize_datetime(
            self.created_to, field_name="created_to", error_code="invalid_scope"
        )
        if created_from is not None and created_to is not None and created_from >= created_to:
            _raise_invalid_scope("created_from must be earlier than created_to")
        object.__setattr__(self, "created_from", created_from)
        object.__setattr__(self, "created_to", created_to)


@dataclass(frozen=True, slots=True)
class HistoryTimelineScope:
    project_id: int
    member_filters: HistoryMemberFilterScope = field(default_factory=HistoryMemberFilterScope)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "project_id",
            _normalize_int(self.project_id, field_name="project_id", error_code="invalid_scope"),
        )
        if not isinstance(self.member_filters, HistoryMemberFilterScope):
            _raise_invalid_scope("member_filters is invalid")


@dataclass(frozen=True, slots=True)
class HistoryTimelineCursor:
    version: int
    snapshot_max_event_id: int
    before_group_max_id: int
    scope: HistoryTimelineScope

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "version",
            _normalize_int(self.version, field_name="version", error_code="invalid_cursor"),
        )
        if self.version != _HISTORY_CURSOR_VERSION:
            _raise_invalid_cursor("history cursor version is unsupported")
        object.__setattr__(
            self,
            "snapshot_max_event_id",
            _normalize_int(
                self.snapshot_max_event_id,
                field_name="snapshot_max_event_id",
                error_code="invalid_cursor",
            ),
        )
        object.__setattr__(
            self,
            "before_group_max_id",
            _normalize_int(
                self.before_group_max_id,
                field_name="before_group_max_id",
                error_code="invalid_cursor",
            ),
        )
        if not isinstance(self.scope, HistoryTimelineScope):
            _raise_invalid_cursor("scope is invalid")


@dataclass(frozen=True, slots=True)
class HistoryDetailScope:
    project_id: int
    batch_id: str
    member_filters: HistoryMemberFilterScope = field(default_factory=HistoryMemberFilterScope)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "project_id",
            _normalize_int(self.project_id, field_name="project_id", error_code="invalid_scope"),
        )
        object.__setattr__(
            self,
            "batch_id",
            _normalize_non_empty_text(
                self.batch_id, field_name="batch_id", max_length=64, error_code="invalid_scope"
            ),
        )
        if not isinstance(self.member_filters, HistoryMemberFilterScope):
            _raise_invalid_scope("member_filters is invalid")


@dataclass(frozen=True, slots=True)
class HistoryCaptureKey:
    target_layer_sort: int
    target_layer_key: str
    source_condition_index: int
    source_condition_id: int
    parameter_sort: int
    parameter_code: str
    event_id: int | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "target_layer_sort",
            _normalize_int(
                self.target_layer_sort,
                field_name="target_layer_sort",
                minimum=0,
                error_code="invalid_cursor",
            ),
        )
        object.__setattr__(
            self,
            "target_layer_key",
            _normalize_non_empty_text(
                self.target_layer_key,
                field_name="target_layer_key",
                max_length=256,
                error_code="invalid_cursor",
            ),
        )
        object.__setattr__(
            self,
            "source_condition_index",
            _normalize_int(
                self.source_condition_index,
                field_name="source_condition_index",
                minimum=0,
                error_code="invalid_cursor",
            ),
        )
        object.__setattr__(
            self,
            "source_condition_id",
            _normalize_int(
                self.source_condition_id,
                field_name="source_condition_id",
                error_code="invalid_cursor",
            ),
        )
        object.__setattr__(
            self,
            "parameter_sort",
            _normalize_int(
                self.parameter_sort,
                field_name="parameter_sort",
                minimum=0,
                error_code="invalid_cursor",
            ),
        )
        object.__setattr__(
            self,
            "parameter_code",
            _normalize_non_empty_text(
                self.parameter_code,
                field_name="parameter_code",
                max_length=64,
                error_code="invalid_cursor",
            ),
        )
        if self.event_id is not None:
            object.__setattr__(
                self,
                "event_id",
                _normalize_int(self.event_id, field_name="event_id", error_code="invalid_cursor"),
            )


@dataclass(frozen=True, slots=True)
class HistoryDetailCursor:
    version: int
    scope: HistoryDetailScope
    order_kind: HistoryOrderKind
    last_event_id: int | None = None
    last_capture_key: HistoryCaptureKey | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "version",
            _normalize_int(self.version, field_name="version", error_code="invalid_cursor"),
        )
        if self.version != _HISTORY_CURSOR_VERSION:
            _raise_invalid_cursor("history cursor version is unsupported")
        if not isinstance(self.scope, HistoryDetailScope):
            _raise_invalid_cursor("scope is invalid")
        if self.order_kind not in {"event_desc", "capture_asc"}:
            _raise_invalid_cursor("order_kind is invalid")
        if self.order_kind == "event_desc":
            if self.last_event_id is None or self.last_capture_key is not None:
                _raise_invalid_cursor("event_desc cursors require last_event_id only")
            object.__setattr__(
                self,
                "last_event_id",
                _normalize_int(
                    self.last_event_id, field_name="last_event_id", error_code="invalid_cursor"
                ),
            )
        else:
            if self.last_event_id is not None or not isinstance(
                self.last_capture_key, HistoryCaptureKey
            ):
                _raise_invalid_cursor("capture_asc cursors require last_capture_key only")


@dataclass(frozen=True, slots=True)
class HistoryCellHistoryCursor:
    version: int
    project_id: int
    condition_id: int
    parameter_code: str
    last_event_id: int

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "version",
            _normalize_int(self.version, field_name="version", error_code="invalid_cursor"),
        )
        if self.version != _HISTORY_CURSOR_VERSION:
            _raise_invalid_cursor("history cursor version is unsupported")
        object.__setattr__(
            self,
            "project_id",
            _normalize_int(self.project_id, field_name="project_id", error_code="invalid_cursor"),
        )
        object.__setattr__(
            self,
            "condition_id",
            _normalize_int(
                self.condition_id, field_name="condition_id", error_code="invalid_cursor"
            ),
        )
        object.__setattr__(
            self,
            "parameter_code",
            _normalize_non_empty_text(
                self.parameter_code,
                field_name="parameter_code",
                max_length=64,
                error_code="invalid_cursor",
            ),
        )
        object.__setattr__(
            self,
            "last_event_id",
            _normalize_int(
                self.last_event_id, field_name="last_event_id", error_code="invalid_cursor"
            ),
        )


def _member_filters_to_payload(filters: HistoryMemberFilterScope) -> dict[str, Any]:
    return {
        "layer_keys": list(filters.layer_keys),
        "event_types": list(filters.event_types),
        "actors": list(filters.actors),
        "origins": list(filters.origins),
        "source_project_ids": list(filters.source_project_ids),
        "created_from": _format_datetime(filters.created_from),
        "created_to": _format_datetime(filters.created_to),
    }


def _member_filters_from_payload(payload: dict[str, Any]) -> HistoryMemberFilterScope:
    if set(payload) != {
        "layer_keys",
        "event_types",
        "actors",
        "origins",
        "source_project_ids",
        "created_from",
        "created_to",
    }:
        if error_code == "invalid_scope":
            _raise_invalid_scope("member filters are invalid")
        _raise_invalid_cursor("member filters are invalid")
    return HistoryMemberFilterScope(
        layer_keys=_normalize_sorted_unique_text_tuple(
            payload["layer_keys"],
            field_name="layer_keys",
            max_length=64,
            error_code="invalid_scope",
        ),
        event_types=_normalize_sorted_unique_text_tuple(
            payload["event_types"],
            field_name="event_types",
            max_length=64,
            error_code="invalid_scope",
        ),
        actors=_normalize_sorted_unique_text_tuple(
            payload["actors"], field_name="actors", max_length=128, error_code=error_code
        ),
        origins=tuple(
            cast(
                HistoryOrigin,
                origin,
            )
            for origin in _normalize_sorted_unique_text_tuple(
                payload["origins"],
                field_name="origins",
                max_length=32,
                error_code="invalid_scope",
            )
        ),
        source_project_ids=_normalize_sorted_unique_int_tuple(
            payload["source_project_ids"],
            field_name="source_project_ids",
            error_code="invalid_scope",
        ),
        created_from=_normalize_datetime(
            payload["created_from"], field_name="created_from", error_code=error_code
        ),
        created_to=_normalize_datetime(
            payload["created_to"], field_name="created_to", error_code=error_code
        ),
        created_to=_normalize_datetime(
            payload["created_to"], field_name="created_to", error_code="invalid_scope"
        ),
    )


def _timeline_scope_to_payload(scope: HistoryTimelineScope) -> dict[str, Any]:
    return {
        "project_id": scope.project_id,
        "member_filters": _member_filters_to_payload(scope.member_filters),
    }


def _timeline_scope_from_payload(payload: dict[str, Any]) -> HistoryTimelineScope:
    if set(payload) != {"project_id", "member_filters"}:
        _raise_invalid_cursor("timeline scope is invalid")
    return HistoryTimelineScope(
        project_id=_normalize_int(
            payload["project_id"], field_name="project_id", error_code="invalid_cursor"
        ),
        member_filters=_member_filters_from_payload(payload["member_filters"]),
    )


def _detail_scope_to_payload(scope: HistoryDetailScope) -> dict[str, Any]:
    return {
        "project_id": scope.project_id,
        "batch_id": scope.batch_id,
        "member_filters": _member_filters_to_payload(scope.member_filters),
    }


def _detail_scope_from_payload(payload: dict[str, Any]) -> HistoryDetailScope:
    if set(payload) != {
        "project_id",
        "batch_id",
        "member_filters",
    }:
        _raise_invalid_scope("detail scope is invalid")
    return HistoryDetailScope(
        project_id=_normalize_int(
            payload["project_id"], field_name="project_id", error_code="invalid_scope"
        ),
        batch_id=_normalize_non_empty_text(
            payload["batch_id"], field_name="batch_id", max_length=64, error_code="invalid_scope"
        ),
        member_filters=_member_filters_from_payload(
            payload["member_filters"], error_code="invalid_scope"
        ),
    )


def _capture_key_to_payload(key: HistoryCaptureKey) -> dict[str, Any]:
    return {
        "target_layer_sort": key.target_layer_sort,
        "target_layer_key": key.target_layer_key,
        "source_condition_index": key.source_condition_index,
        "source_condition_id": key.source_condition_id,
        "parameter_sort": key.parameter_sort,
        "parameter_code": key.parameter_code,
        "event_id": key.event_id,
    }


def _capture_key_from_payload(payload: dict[str, Any]) -> HistoryCaptureKey:
    if set(payload) != {
        "target_layer_sort",
        "target_layer_key",
        "source_condition_index",
        "source_condition_id",
        "parameter_sort",
        "parameter_code",
        "event_id",
    }:
        _raise_invalid_cursor("capture key is invalid")
    return HistoryCaptureKey(
        target_layer_sort=_normalize_int(
            payload["target_layer_sort"],
            field_name="target_layer_sort",
            minimum=0,
            error_code="invalid_cursor",
        ),
        target_layer_key=_normalize_non_empty_text(
            payload["target_layer_key"],
            field_name="target_layer_key",
            max_length=64,
            error_code="invalid_cursor",
        ),
        source_condition_index=_normalize_int(
            payload["source_condition_index"],
            field_name="source_condition_index",
            minimum=0,
            error_code="invalid_cursor",
        ),
        source_condition_id=_normalize_int(
            payload["source_condition_id"],
            field_name="source_condition_id",
            error_code="invalid_cursor",
        ),
        parameter_sort=_normalize_int(
            payload["parameter_sort"],
            field_name="parameter_sort",
            minimum=0,
            error_code="invalid_cursor",
        ),
        parameter_code=_normalize_non_empty_text(
            payload["parameter_code"],
            field_name="parameter_code",
            max_length=64,
            error_code="invalid_cursor",
        ),
        event_id=_normalize_optional_int(payload["event_id"], field_name="event_id"),
    )


def encode_history_timeline_cursor(cursor: HistoryTimelineCursor) -> str:
    scope_payload = _timeline_scope_to_payload(cursor.scope)
    return _encode_payload(
        {
            "v": cursor.version,
            "snapshot_max_event_id": cursor.snapshot_max_event_id,
            "before_group_max_id": cursor.before_group_max_id,
            "scope": scope_payload,
            "scope_fingerprint": _fingerprint_payload(scope_payload),
        }
    )


def decode_history_timeline_cursor(
    raw: str, *, expected_scope: HistoryTimelineScope | None = None
) -> HistoryTimelineCursor:
    payload = _decode_payload(raw, error_code="invalid_cursor")
    if set(payload) != {
        "v",
        "snapshot_max_event_id",
        "before_group_max_id",
        "scope",
        "scope_fingerprint",
    }:
        _raise_invalid_cursor("history cursor token is invalid")
    payload_dict = cast(dict[str, Any], payload)
    cursor = HistoryTimelineCursor(
        version=_normalize_int(
            payload_dict["v"], field_name="version", error_code="invalid_cursor"
        ),
        snapshot_max_event_id=_normalize_int(
            payload_dict["snapshot_max_event_id"],
            field_name="snapshot_max_event_id",
            error_code="invalid_cursor",
        ),
        before_group_max_id=_normalize_int(
            payload_dict["before_group_max_id"],
            field_name="before_group_max_id",
            error_code="invalid_cursor",
        ),
        scope=_timeline_scope_from_payload(cast(dict[str, Any], payload_dict["scope"])),
    )
    if expected_scope is not None and cursor.scope != expected_scope:
        _raise_invalid_scope("history timeline scope does not match the cursor")
    return cursor


def encode_history_detail_scope(scope: HistoryDetailScope) -> str:
    return _encode_payload({"v": _HISTORY_CURSOR_VERSION, "scope": _detail_scope_to_payload(scope)})


def decode_history_detail_scope(raw: str) -> HistoryDetailScope:
    payload = _decode_payload(raw, error_code="invalid_scope")
    if set(payload) != {"v", "scope"}:
        _raise_invalid_scope("history scope token is invalid")
    payload_dict = cast(dict[str, Any], payload)
    version = _normalize_int(
        payload_dict["v"], field_name="version", error_code="invalid_scope"
    )
    if version != _HISTORY_CURSOR_VERSION:
        _raise_invalid_scope("history scope version is unsupported")
    return _detail_scope_from_payload(cast(dict[str, Any], payload_dict["scope"]))


def encode_history_detail_cursor(cursor: HistoryDetailCursor) -> str:
    scope_payload = _detail_scope_to_payload(cursor.scope)
    payload: dict[str, Any] = {
        "v": cursor.version,
        "scope": scope_payload,
        "scope_fingerprint": _fingerprint_payload(scope_payload),
        "order_kind": cursor.order_kind,
    }
    if cursor.order_kind == "event_desc":
        payload["last_event_id"] = cursor.last_event_id
    else:
        capture_key = cursor.last_capture_key
        assert capture_key is not None
        payload["last_capture_key"] = _capture_key_to_payload(capture_key)
    return _encode_payload(payload)


def decode_history_detail_cursor(
    raw: str, *, expected_scope: HistoryDetailScope | None = None
) -> HistoryDetailCursor:
    payload = _decode_payload(raw, error_code="invalid_cursor")
    if payload.get("order_kind") not in {"event_desc", "capture_asc"}:
        _raise_invalid_cursor("history cursor token is invalid")
    payload_dict = cast(dict[str, Any], payload)
    if payload.get("order_kind") == "event_desc":
        if set(payload) != {
            "v",
            "scope",
            "scope_fingerprint",
            "order_kind",
            "last_event_id",
        }:
            _raise_invalid_cursor("history cursor token is invalid")
        cursor = HistoryDetailCursor(
            version=_normalize_int(
                payload_dict["v"], field_name="version", error_code="invalid_cursor"
            ),
            scope=_detail_scope_from_payload(cast(dict[str, Any], payload_dict["scope"])),
            order_kind="event_desc",
            last_event_id=_normalize_int(
                payload_dict["last_event_id"],
                field_name="last_event_id",
                error_code="invalid_cursor",
            ),
        )
    else:
        if set(payload) != {"v", "scope", "scope_fingerprint", "order_kind", "last_capture_key"}:
            _raise_invalid_cursor("history cursor token is invalid")
        cursor = HistoryDetailCursor(
            version=_normalize_int(
                payload_dict["v"], field_name="version", error_code="invalid_cursor"
            ),
            scope=_detail_scope_from_payload(cast(dict[str, Any], payload_dict["scope"])),
            order_kind="capture_asc",
            last_capture_key=_capture_key_from_payload(
                cast(dict[str, Any], payload_dict["last_capture_key"])
            ),
        )
    if expected_scope is not None and cursor.scope != expected_scope:
        _raise_invalid_scope("history detail scope does not match the cursor")
    return cursor


def encode_history_cell_history_cursor(cursor: HistoryCellHistoryCursor) -> str:
    return _encode_payload(
        {
            "v": cursor.version,
            "project_id": cursor.project_id,
            "condition_id": cursor.condition_id,
            "parameter_code": cursor.parameter_code,
            "last_event_id": cursor.last_event_id,
        }
    )


def decode_history_cell_history_cursor(
    raw: str,
    *,
    expected_project_id: int | None = None,
    expected_condition_id: int | None = None,
    expected_parameter_code: str | None = None,
) -> HistoryCellHistoryCursor:
    payload = _decode_payload(raw, error_code="invalid_cursor")
    if set(payload) != {"v", "project_id", "condition_id", "parameter_code", "last_event_id"}:
        _raise_invalid_cursor("history cursor token is invalid")
    payload_dict = cast(dict[str, Any], payload)
    cursor = HistoryCellHistoryCursor(
        version=_normalize_int(
            payload_dict["v"], field_name="version", error_code="invalid_cursor"
        ),
        project_id=_normalize_int(
            payload_dict["project_id"], field_name="project_id", error_code="invalid_cursor"
        ),
        condition_id=_normalize_int(
            payload_dict["condition_id"], field_name="condition_id", error_code="invalid_cursor"
        ),
        parameter_code=_normalize_non_empty_text(
            payload_dict["parameter_code"],
            field_name="parameter_code",
            max_length=64,
            error_code="invalid_cursor",
        ),
        last_event_id=_normalize_int(
            payload_dict["last_event_id"],
            field_name="last_event_id",
            error_code="invalid_cursor",
        ),
    )
    if (
        (expected_project_id is not None and cursor.project_id != expected_project_id)
        or (expected_condition_id is not None and cursor.condition_id != expected_condition_id)
        or (
            expected_parameter_code is not None
            and cursor.parameter_code != expected_parameter_code.strip()
        )
    ):
        _raise_invalid_scope("history cell scope does not match the cursor")
    return cursor


def ensure_history_scope_matches(expected: object, observed: object) -> None:
    if expected != observed:
        _raise_invalid_scope("history scope does not match")


__all__ = [
    "HistoryCaptureKey",
    "HistoryCellHistoryCursor",
    "HistoryDetailCursor",
    "HistoryDetailScope",
    "HistoryMemberFilterScope",
    "HistoryOrderKind",
    "HistoryOrigin",
    "HistoryTimelineCursor",
    "HistoryTimelineScope",
    "decode_history_cell_history_cursor",
    "decode_history_detail_cursor",
    "decode_history_detail_scope",
    "decode_history_timeline_cursor",
    "encode_history_cell_history_cursor",
    "encode_history_detail_cursor",
    "encode_history_detail_scope",
    "encode_history_timeline_cursor",
    "ensure_history_scope_matches",
]
