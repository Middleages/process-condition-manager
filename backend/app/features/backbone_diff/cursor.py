"""Opaque, versioned scopes and cursors for backbone diff requests."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Literal, NoReturn, cast

_TOKEN_VERSION = 1
_MAX_TOKEN_LENGTH = 4096

BackboneDiffClassification = Literal["added", "changed", "cleared", "removed", "unchanged"]
BackboneDiffCursorKind = Literal["root", "branch", "cell"]
BackboneDiffRowStatus = Literal["matched", "added", "removed"]


def _raise_invalid_scope(message: str) -> NoReturn:
    from app.domain.errors import RuleViolationError

    raise RuleViolationError(message, code="invalid_scope")


def _raise_invalid_cursor(message: str) -> NoReturn:
    from app.domain.errors import RuleViolationError

    raise RuleViolationError(message, code="invalid_cursor")


def _raise_invalid_row_ref(message: str) -> NoReturn:
    from app.domain.errors import RuleViolationError

    raise RuleViolationError(message, code="invalid_row_ref")


def _raise_invalid_token(message: str, *, token_kind: str) -> NoReturn:
    if token_kind == "scope":
        _raise_invalid_scope(message)
    if token_kind == "cursor":
        _raise_invalid_cursor(message)
    _raise_invalid_row_ref(message)


def _is_safe_token_character(character: str) -> bool:
    return character.isascii() and (character.isalnum() or character in "_-")


def _encode_payload(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_payload(raw: str, *, token_kind: str) -> dict[str, Any]:
    if not isinstance(raw, str) or not raw or len(raw) > _MAX_TOKEN_LENGTH:
        _raise_invalid_token("backbone diff token is invalid", token_kind=token_kind)
    if any(not _is_safe_token_character(character) for character in raw):
        _raise_invalid_token("backbone diff token is invalid", token_kind=token_kind)
    try:
        padding = "=" * (-len(raw) % 4)
        decoded = base64.b64decode(raw + padding, altchars=b"-_", validate=True)
        payload = json.loads(decoded)
        if not isinstance(payload, dict):
            raise ValueError
        return payload
    except (binascii.Error, json.JSONDecodeError, TypeError, UnicodeDecodeError, ValueError):
        _raise_invalid_token("backbone diff token is invalid", token_kind=token_kind)
    raise AssertionError("unreachable")


def _require_int(raw: object, *, field_name: str, minimum: int = 0) -> int:
    if type(raw) is not int or raw < minimum:
        _raise_invalid_scope(f"{field_name} is invalid")
    return cast(int, raw)


def _require_positive_int(raw: object, *, field_name: str) -> int:
    return _require_int(raw, field_name=field_name, minimum=1)


def _require_text(raw: object, *, field_name: str, max_length: int) -> str:
    if not isinstance(raw, str):
        _raise_invalid_scope(f"{field_name} must be text")
    value = raw.strip()
    if not value or len(value) > max_length:
        _raise_invalid_scope(f"{field_name} is invalid")
    return value


def _require_optional_text(raw: object, *, field_name: str, max_length: int) -> str | None:
    if raw is None:
        return None
    return _require_text(raw, field_name=field_name, max_length=max_length)


def _require_bool(raw: object, *, field_name: str) -> bool:
    if type(raw) is not bool:
        _raise_invalid_scope(f"{field_name} must be boolean")
    return cast(bool, raw)


def _require_sorted_unique_text_tuple(
    raw: object,
    *,
    field_name: str,
    max_length: int,
) -> tuple[str, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list | tuple):
        _raise_invalid_scope(f"{field_name} must be a list")
    values = [_require_text(item, field_name=field_name, max_length=max_length) for item in raw]
    if len(values) != len(set(values)):
        _raise_invalid_scope(f"{field_name} values must be unique")
    return tuple(sorted(values))


def _require_sort_key(raw: object) -> tuple[object, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list | tuple):
        _raise_invalid_cursor("sort_key must be a list")
    values: list[object] = []
    for item in raw:
        if item is None or type(item) in {int, str, bool}:
            values.append(item)
            continue
        _raise_invalid_cursor("sort_key contains an unsupported value")
    return tuple(values)


def _require_classifications(raw: object) -> tuple[str, ...]:
    values = _require_sorted_unique_text_tuple(raw, field_name="classification", max_length=32)
    allowed = {"added", "changed", "cleared", "removed", "unchanged"}
    if any(value not in allowed for value in values):
        _raise_invalid_scope("classification contains an unsupported value")
    return values


@dataclass(frozen=True, slots=True)
class BackboneDiffFilters:
    classification: tuple[BackboneDiffClassification, ...] = field(default_factory=tuple)
    category_code: str | None = None
    parameter_code: str | None = None
    include_unchanged: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "classification",
            cast(tuple[BackboneDiffClassification, ...], _require_classifications(self.classification)),
        )
        object.__setattr__(
            self,
            "category_code",
            _require_optional_text(self.category_code, field_name="category_code", max_length=64),
        )
        object.__setattr__(
            self,
            "parameter_code",
            _require_optional_text(self.parameter_code, field_name="parameter_code", max_length=64),
        )
        object.__setattr__(
            self,
            "include_unchanged",
            _require_bool(self.include_unchanged, field_name="include_unchanged"),
        )


@dataclass(frozen=True, slots=True)
class BackboneDiffRowRef:
    project_id: int
    layer_key: str
    row_status: BackboneDiffRowStatus
    baseline_condition_id: int | None = None
    current_condition_id: int | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "project_id", _require_positive_int(self.project_id, field_name="project_id")
        )
        object.__setattr__(
            self, "layer_key", _require_text(self.layer_key, field_name="layer_key", max_length=256)
        )
        object.__setattr__(
            self,
            "row_status",
            self.row_status if self.row_status in {"matched", "added", "removed"} else _raise_invalid_row_ref("row_status is invalid"),
        )
        if self.row_status == "matched":
            if self.baseline_condition_id is None or self.current_condition_id is None:
                _raise_invalid_row_ref("matched row_ref requires baseline and current IDs")
        elif self.row_status == "added":
            if self.baseline_condition_id is not None or self.current_condition_id is None:
                _raise_invalid_row_ref("added row_ref requires only a current ID")
        elif self.row_status == "removed":
            if self.baseline_condition_id is None or self.current_condition_id is not None:
                _raise_invalid_row_ref("removed row_ref requires only a baseline ID")

        if self.baseline_condition_id is not None:
            object.__setattr__(
                self,
                "baseline_condition_id",
                _require_positive_int(self.baseline_condition_id, field_name="baseline_condition_id"),
            )
        if self.current_condition_id is not None:
            object.__setattr__(
                self,
                "current_condition_id",
                _require_positive_int(self.current_condition_id, field_name="current_condition_id"),
            )

    @property
    def identity_key(self) -> tuple[int, int]:
        if self.row_status == "matched":
            assert self.baseline_condition_id is not None
            assert self.current_condition_id is not None
            return (self.baseline_condition_id, self.current_condition_id)
        if self.row_status == "added":
            assert self.current_condition_id is not None
            return (self.current_condition_id, self.current_condition_id)
        assert self.baseline_condition_id is not None
        return (self.baseline_condition_id, self.baseline_condition_id)


@dataclass(frozen=True, slots=True)
class BackboneDiffRootScope:
    project_id: int
    basis_hash: str
    filters: BackboneDiffFilters = field(default_factory=BackboneDiffFilters)

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "project_id", _require_positive_int(self.project_id, field_name="project_id")
        )
        object.__setattr__(
            self, "basis_hash", _require_text(self.basis_hash, field_name="basis_hash", max_length=128)
        )
        if not isinstance(self.filters, BackboneDiffFilters):
            _raise_invalid_scope("filters must be BackboneDiffFilters")


@dataclass(frozen=True, slots=True)
class BackboneDiffBranchScope:
    project_id: int
    layer_key: str
    basis_hash: str
    filters: BackboneDiffFilters = field(default_factory=BackboneDiffFilters)

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "project_id", _require_positive_int(self.project_id, field_name="project_id")
        )
        object.__setattr__(
            self, "layer_key", _require_text(self.layer_key, field_name="layer_key", max_length=256)
        )
        object.__setattr__(
            self, "basis_hash", _require_text(self.basis_hash, field_name="basis_hash", max_length=128)
        )
        if not isinstance(self.filters, BackboneDiffFilters):
            _raise_invalid_scope("filters must be BackboneDiffFilters")


@dataclass(frozen=True, slots=True)
class BackboneDiffCellScope:
    project_id: int
    layer_key: str
    basis_hash: str
    row_ref: BackboneDiffRowRef
    filters: BackboneDiffFilters = field(default_factory=BackboneDiffFilters)

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "project_id", _require_positive_int(self.project_id, field_name="project_id")
        )
        object.__setattr__(
            self, "layer_key", _require_text(self.layer_key, field_name="layer_key", max_length=256)
        )
        object.__setattr__(
            self, "basis_hash", _require_text(self.basis_hash, field_name="basis_hash", max_length=128)
        )
        if not isinstance(self.row_ref, BackboneDiffRowRef):
            _raise_invalid_scope("row_ref must be BackboneDiffRowRef")
        if not isinstance(self.filters, BackboneDiffFilters):
            _raise_invalid_scope("filters must be BackboneDiffFilters")


@dataclass(frozen=True, slots=True)
class BackboneDiffCursor:
    version: int
    kind: BackboneDiffCursorKind
    scope: BackboneDiffRootScope | BackboneDiffBranchScope | BackboneDiffCellScope
    sort_key: tuple[object, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if self.version != _TOKEN_VERSION:
            _raise_invalid_cursor("unsupported backbone diff cursor version")
        if self.kind not in {"root", "branch", "cell"}:
            _raise_invalid_cursor("unsupported backbone diff cursor kind")
        if not isinstance(
            self.scope, BackboneDiffRootScope | BackboneDiffBranchScope | BackboneDiffCellScope
        ):
            _raise_invalid_cursor("cursor scope is invalid")
        object.__setattr__(self, "sort_key", _require_sort_key(self.sort_key))


def _filters_payload(filters: BackboneDiffFilters) -> dict[str, Any]:
    return {
        "classification": list(filters.classification),
        "category_code": filters.category_code,
        "include_unchanged": filters.include_unchanged,
        "parameter_code": filters.parameter_code,
    }


def _filters_from_payload(payload: Any) -> BackboneDiffFilters:
    mapping = payload if isinstance(payload, dict) else None
    if mapping is None:
        _raise_invalid_scope("filters are invalid")
    return BackboneDiffFilters(
        classification=tuple(mapping.get("classification") or ()),
        category_code=mapping.get("category_code"),
        parameter_code=mapping.get("parameter_code"),
        include_unchanged=mapping.get("include_unchanged", False),
    )


def _scope_payload(scope: BackboneDiffRootScope | BackboneDiffBranchScope | BackboneDiffCellScope) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "basis_hash": scope.basis_hash,
        "filters": _filters_payload(scope.filters),
        "project_id": scope.project_id,
        "version": _TOKEN_VERSION,
    }
    if isinstance(scope, BackboneDiffBranchScope):
        payload["kind"] = "branch"
        payload["layer_key"] = scope.layer_key
    elif isinstance(scope, BackboneDiffCellScope):
        payload["kind"] = "cell"
        payload["layer_key"] = scope.layer_key
        payload["row_ref"] = _row_ref_payload(scope.row_ref)
    else:
        payload["kind"] = "root"
    return payload


def _scope_from_payload(payload: dict[str, Any]) -> BackboneDiffRootScope | BackboneDiffBranchScope | BackboneDiffCellScope:
    if payload.get("version") != _TOKEN_VERSION:
        _raise_invalid_scope("backbone diff scope version is unsupported")
    filters = _filters_from_payload(payload.get("filters"))
    kind = payload.get("kind")
    project_id = _require_positive_int(payload.get("project_id"), field_name="project_id")
    basis_hash = _require_text(payload.get("basis_hash"), field_name="basis_hash", max_length=128)
    if kind == "root":
        return BackboneDiffRootScope(project_id=project_id, basis_hash=basis_hash, filters=filters)
    if kind == "branch":
        return BackboneDiffBranchScope(
            project_id=project_id,
            layer_key=_require_text(payload.get("layer_key"), field_name="layer_key", max_length=256),
            basis_hash=basis_hash,
            filters=filters,
        )
    if kind == "cell":
        row_ref = _row_ref_from_payload(payload.get("row_ref"))
        return BackboneDiffCellScope(
            project_id=project_id,
            layer_key=_require_text(payload.get("layer_key"), field_name="layer_key", max_length=256),
            basis_hash=basis_hash,
            row_ref=row_ref,
            filters=filters,
        )
    _raise_invalid_scope("unsupported backbone diff scope kind")
    raise AssertionError("unreachable")


def _row_ref_payload(row_ref: BackboneDiffRowRef) -> dict[str, Any]:
    return {
        "baseline_condition_id": row_ref.baseline_condition_id,
        "current_condition_id": row_ref.current_condition_id,
        "kind": "row_ref",
        "layer_key": row_ref.layer_key,
        "project_id": row_ref.project_id,
        "row_status": row_ref.row_status,
        "version": _TOKEN_VERSION,
    }


def _row_ref_from_payload(payload: Any) -> BackboneDiffRowRef:
    mapping = payload if isinstance(payload, dict) else None
    if mapping is None or mapping.get("version") != _TOKEN_VERSION or mapping.get("kind") != "row_ref":
        _raise_invalid_row_ref("backbone diff row_ref is invalid")
    return BackboneDiffRowRef(
        project_id=_require_positive_int(mapping.get("project_id"), field_name="project_id"),
        layer_key=_require_text(mapping.get("layer_key"), field_name="layer_key", max_length=256),
        row_status=mapping.get("row_status"),
        baseline_condition_id=(
            None
            if mapping.get("baseline_condition_id") is None
            else _require_positive_int(mapping.get("baseline_condition_id"), field_name="baseline_condition_id")
        ),
        current_condition_id=(
            None
            if mapping.get("current_condition_id") is None
            else _require_positive_int(mapping.get("current_condition_id"), field_name="current_condition_id")
        ),
    )


def _cursor_payload(cursor: BackboneDiffCursor) -> dict[str, Any]:
    return {
        "kind": cursor.kind,
        "scope": _scope_payload(cursor.scope),
        "sort_key": list(cursor.sort_key),
        "version": _TOKEN_VERSION,
    }


def _cursor_from_payload(payload: dict[str, Any]) -> BackboneDiffCursor:
    if payload.get("version") != _TOKEN_VERSION:
        _raise_invalid_cursor("backbone diff cursor version is unsupported")
    kind = payload.get("kind")
    if kind not in {"root", "branch", "cell"}:
        _raise_invalid_cursor("backbone diff cursor kind is invalid")
    scope = _scope_from_payload(payload.get("scope") if isinstance(payload.get("scope"), dict) else {})
    return BackboneDiffCursor(
        version=_TOKEN_VERSION,
        kind=cast(BackboneDiffCursorKind, kind),
        scope=scope,
        sort_key=_require_sort_key(payload.get("sort_key")),
    )


def encode_backbone_diff_scope(
    scope: BackboneDiffRootScope | BackboneDiffBranchScope | BackboneDiffCellScope,
) -> str:
    return _encode_payload(_scope_payload(scope))


def decode_backbone_diff_scope(token: str) -> BackboneDiffRootScope | BackboneDiffBranchScope | BackboneDiffCellScope:
    return _scope_from_payload(_decode_payload(token, token_kind="scope"))


def encode_backbone_diff_row_ref(row_ref: BackboneDiffRowRef) -> str:
    return _encode_payload(_row_ref_payload(row_ref))


def decode_backbone_diff_row_ref(token: str) -> BackboneDiffRowRef:
    return _row_ref_from_payload(_decode_payload(token, token_kind="row_ref"))


def encode_backbone_diff_cursor(cursor: BackboneDiffCursor) -> str:
    return _encode_payload(_cursor_payload(cursor))


def decode_backbone_diff_cursor(token: str) -> BackboneDiffCursor:
    return _cursor_from_payload(_decode_payload(token, token_kind="cursor"))


def backbone_diff_basis_fingerprint(
    scope: BackboneDiffRootScope | BackboneDiffBranchScope | BackboneDiffCellScope,
) -> str:
    canonical_json = json.dumps(_scope_payload(scope), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    digest = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


__all__ = [
    "BackboneDiffBranchScope",
    "BackboneDiffCellScope",
    "BackboneDiffClassification",
    "BackboneDiffCursor",
    "BackboneDiffCursorKind",
    "BackboneDiffFilters",
    "BackboneDiffRowRef",
    "BackboneDiffRowStatus",
    "BackboneDiffRootScope",
    "backbone_diff_basis_fingerprint",
    "decode_backbone_diff_cursor",
    "decode_backbone_diff_row_ref",
    "decode_backbone_diff_scope",
    "encode_backbone_diff_cursor",
    "encode_backbone_diff_row_ref",
    "encode_backbone_diff_scope",
]
