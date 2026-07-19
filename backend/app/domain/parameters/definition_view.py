"""Fail-closed projections over an approved project's frozen definition snapshot."""

from __future__ import annotations

import copy
import hmac
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, NoReturn

from app.core.errors import DomainValidationError
from app.domain.parameters.snapshot import snapshot_digest
from app.domain.parameters.types import ValueType
from app.domain.validation import (
    ChoiceDefinition,
    ParameterDefinition,
    PriorPorSpec,
    RequiredIfSpec,
    ValidationRuleDefinition,
    ValidationScope,
    ValidationSeverity,
)

_HASH_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")


@dataclass(frozen=True)
class DefinitionView:
    """Owned immutable view of snapshot-v3 data.

    The constructor takes a deep copy and every collection projection returns a
    deep copy.  Callers therefore cannot mutate approval truth through an alias.
    """

    _snapshot: Mapping[str, Any]

    @classmethod
    def from_snapshot(cls, raw: Any) -> DefinitionView:
        if raw is None or not isinstance(raw, Mapping):
            _invalid("snapshot must be a mapping")

        snapshot = copy.deepcopy(dict(raw))
        expected_keys = {
            "version",
            "categories",
            "parameters",
            "choice_sets",
            "validation_rules",
            "validation_basis_hash",
        }
        if set(snapshot.keys()) != expected_keys:
            _invalid("snapshot keys are invalid", {"keys": sorted(snapshot.keys())})
        if snapshot["version"] != 3:
            _invalid("snapshot version must be 3", {"version": snapshot["version"]})
        for field in ("categories", "parameters", "choice_sets", "validation_rules"):
            if not isinstance(snapshot[field], list):
                _invalid(f"snapshot.{field} must be a list")

        basis_hash = snapshot["validation_basis_hash"]
        if not isinstance(basis_hash, str) or _HASH_PATTERN.fullmatch(basis_hash) is None:
            _invalid("snapshot.validation_basis_hash format is invalid")

        _validate_nested_snapshot(snapshot)
        if not hmac.compare_digest(basis_hash, snapshot_digest(snapshot)):
            _invalid("snapshot.validation_basis_hash does not match content")
        view = cls(snapshot)
        # Exercise the typed projections at the boundary so no endpoint is the
        # first consumer to discover corrupt approved JSON.
        view.parameter_definitions()
        view.validation_rule_definitions()
        return view

    @property
    def validation_basis_hash(self) -> str:
        return self._snapshot["validation_basis_hash"]

    def columns(self) -> list[dict[str, Any]]:
        choice_set_version_by_code = {
            str(choice_set["code"]): int(choice_set["version"])
            for choice_set in self._mappings("choice_sets")
        }
        columns: list[dict[str, Any]] = []
        for column in self._mappings("parameters"):
            item = copy.deepcopy(dict(column))
            if item.get("value_type") == "choice":
                choice_set_code = item.get("choice_set_code")
                if choice_set_code is None:
                    _invalid("choice parameter missing choice_set_code")
                item["choice_set_version"] = choice_set_version_by_code.get(str(choice_set_code))
                if item["choice_set_version"] is None:
                    _invalid("choice parameter references missing choice set")
            columns.append(item)
        return columns

    def rules(self) -> list[dict[str, Any]]:
        return copy.deepcopy([dict(item) for item in self._mappings("validation_rules")])

    def frozen_choice_sets(self) -> list[dict[str, Any]]:
        return copy.deepcopy([dict(item) for item in self._mappings("choice_sets")])

    def resolve_choice(self, set_code: str, option_code: str) -> dict[str, Any]:
        """Resolve a Profile/parameter choice without consulting the live registry."""
        for choice_set in self._mappings("choice_sets"):
            if choice_set.get("code") != set_code:
                continue
            options = choice_set.get("options")
            if not isinstance(options, list):
                _invalid("snapshot choice_set.options must be a list")
            for option in options:
                if not isinstance(option, Mapping):
                    _invalid("snapshot choice option entry is not a mapping")
                if option.get("code") == option_code:
                    label = option.get("label")
                    if not isinstance(label, str):
                        _invalid("snapshot choice option label is invalid")
                    return {
                        "set_code": set_code,
                        "option_code": option_code,
                        "label": label,
                        "set_is_active": bool(choice_set.get("is_active", True)),
                        "option_is_active": bool(option.get("is_active", True)),
                    }
            _invalid(
                "snapshot choice option is missing",
                {"set_code": set_code, "option_code": option_code},
            )
        _invalid("snapshot choice set is missing", {"set_code": set_code})

    def parameter_definitions(self) -> tuple[ParameterDefinition, ...]:
        choice_sets = {str(row["code"]): row for row in self._mappings("choice_sets")}
        definitions: list[ParameterDefinition] = []
        try:
            for row in self._mappings("parameters"):
                value_type = ValueType(str(row["value_type"]))
                set_code = str(row["choice_set_code"]) if value_type is ValueType.CHOICE else None
                choices: tuple[ChoiceDefinition, ...] = ()
                if set_code is not None:
                    choice_set = choice_sets[set_code]
                    options = choice_set["options"]
                    if not isinstance(options, list):
                        _invalid("snapshot choice_set.options must be a list")
                    choices = tuple(
                        ChoiceDefinition(
                            code=str(option["code"]),
                            is_active=bool(choice_set.get("is_active", True))
                            and bool(option.get("is_active", True)),
                        )
                        for option in options
                        if isinstance(option, Mapping)
                    )
                definitions.append(
                    ParameterDefinition(
                        code=str(row["code"]),
                        display_name=str(row["display_name"]),
                        value_type=value_type,
                        required=bool(row.get("required", False)),
                        pattern=_optional_str(row.get("pattern")),
                        pattern_hint=_optional_str(row.get("pattern_hint")),
                        min_value=_optional_str(row.get("min_value")),
                        max_value=_optional_str(row.get("max_value")),
                        choice_set_code=set_code,
                        choices=choices,
                        sort_order=int(row.get("sort_order", 0)),
                    )
                )
        except (KeyError, TypeError, ValueError) as exc:
            _invalid("snapshot parameter definition is invalid", cause=exc)
        return tuple(definitions)

    def validation_rule_definitions(self) -> tuple[ValidationRuleDefinition, ...]:
        definitions: list[ValidationRuleDefinition] = []
        try:
            for row in self._mappings("validation_rules"):
                scope_row = row["scope"]
                spec_row = row["spec"]
                if not isinstance(scope_row, Mapping) or not isinstance(spec_row, Mapping):
                    _invalid("snapshot validation rule scope/spec is invalid")
                scope = ValidationScope(
                    line_ids=_string_tuple(scope_row.get("line_ids", [])),
                    process_ids=_string_tuple(scope_row.get("process_ids", [])),
                    layer_ids=_string_tuple(scope_row.get("layer_ids", [])),
                    step_seqs=_string_tuple(scope_row.get("step_seqs", [])),
                    eqp_types=_string_tuple(scope_row.get("eqp_types", [])),
                    area_names=_string_tuple(scope_row.get("area_names", [])),
                )
                rule_type = spec_row["type"]
                if rule_type == "required_if":
                    spec = RequiredIfSpec(
                        when_parameter_code=str(spec_row["when_parameter_code"]),
                        equals=str(spec_row["equals"]),
                        required_parameter_code=str(spec_row["required_parameter_code"]),
                        schema_version=int(spec_row["schema_version"]),
                    )
                elif rule_type == "value_exists_in_prior_por":
                    spec = PriorPorSpec(
                        source_parameter_code=str(spec_row["source_parameter_code"]),
                        candidate_parameter_code=str(spec_row["candidate_parameter_code"]),
                        schema_version=int(spec_row["schema_version"]),
                    )
                else:
                    _invalid("snapshot validation rule type is invalid", {"type": rule_type})
                definitions.append(
                    ValidationRuleDefinition(
                        code=str(row["code"]),
                        name=str(row["name"]),
                        severity=ValidationSeverity(str(row["severity"])),
                        version=int(row["version"]),
                        scope=scope,
                        spec=spec,
                    )
                )
        except (KeyError, TypeError, ValueError) as exc:
            _invalid("snapshot validation rule is invalid", cause=exc)
        return tuple(definitions)

    def _mappings(self, field: str) -> list[Mapping[str, Any]]:
        values = self._snapshot[field]
        output: list[Mapping[str, Any]] = []
        for value in values:
            if not isinstance(value, Mapping):
                _invalid(f"snapshot {field} entry is not a mapping")
            output.append(value)
        return output


def _string_tuple(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        _invalid("snapshot validation scope field must be a list")
    if not all(isinstance(item, str) for item in value):
        _invalid("snapshot validation scope field contains non-string item")
    return tuple(value)


def _optional_str(value: Any) -> str | None:
    if value is not None and not isinstance(value, str):
        _invalid("snapshot optional text field is invalid")
    return value


def _validate_nested_snapshot(snapshot: Mapping[str, Any]) -> None:
    categories = _mapping_entries(snapshot, "categories")
    parameters = _mapping_entries(snapshot, "parameters")
    choice_sets = _mapping_entries(snapshot, "choice_sets")
    rules = _mapping_entries(snapshot, "validation_rules")

    _validate_unique_codes(categories, "category")
    _validate_unique_codes(parameters, "parameter")
    _validate_unique_codes(choice_sets, "choice set")
    _validate_unique_codes(rules, "validation rule")

    for row in categories:
        _text(row, "code")
        _text(row, "display_name")
        _integer(row, "sort_order", minimum=0)

    choice_codes: set[str] = set()
    for row in choice_sets:
        code = _text(row, "code")
        choice_codes.add(code)
        _text(row, "display_name")
        _integer(row, "version", minimum=1)
        _boolean(row, "is_active")
        options = row.get("options")
        if not isinstance(options, list):
            _invalid("snapshot choice_set.options must be a list")
        option_rows = _mapping_values(options, "choice option")
        _validate_unique_codes(option_rows, f"choice option in {code}")
        for option in option_rows:
            _text(option, "code")
            _text(option, "label")
            _integer(option, "sort_order", minimum=0)
            _boolean(option, "is_active")

    for row in parameters:
        _text(row, "code")
        _text(row, "display_name")
        value_type = _text(row, "value_type")
        try:
            ValueType(value_type)
        except ValueError as exc:
            _invalid("snapshot parameter value_type is invalid", cause=exc)
        _optional_text(row, "description")
        _optional_text(row, "category_code")
        _optional_text(row, "unit")
        _optional_text(row, "min_value")
        _optional_text(row, "max_value")
        _boolean(row, "required")
        _optional_text(row, "pattern")
        _optional_text(row, "pattern_hint")
        _integer(row, "sort_order", minimum=0)
        if value_type == ValueType.CHOICE.value:
            set_code = _text(row, "choice_set_code")
            if set_code not in choice_codes:
                _invalid("choice parameter references missing choice set")

    for row in rules:
        _text(row, "code")
        _text(row, "name")
        _text(row, "severity")
        _integer(row, "version", minimum=1)
        scope = row.get("scope")
        spec = row.get("spec")
        if not isinstance(scope, Mapping) or not isinstance(spec, Mapping):
            _invalid("snapshot validation rule scope/spec is invalid")
        for key in (
            "line_ids",
            "process_ids",
            "layer_ids",
            "step_seqs",
            "eqp_types",
            "area_names",
        ):
            _string_tuple(scope.get(key, []))
        _text(spec, "type")
        _integer(spec, "schema_version", minimum=1)


def _mapping_entries(snapshot: Mapping[str, Any], field: str) -> list[Mapping[str, Any]]:
    return _mapping_values(snapshot[field], field)


def _mapping_values(values: list[Any], field: str) -> list[Mapping[str, Any]]:
    rows: list[Mapping[str, Any]] = []
    for value in values:
        if not isinstance(value, Mapping):
            _invalid(f"snapshot {field} entry is not a mapping")
        rows.append(value)
    return rows


def _validate_unique_codes(rows: list[Mapping[str, Any]], field: str) -> None:
    codes = [_text(row, "code") for row in rows]
    if len(codes) != len(set(codes)):
        _invalid(f"snapshot {field} codes are duplicated")


def _text(row: Mapping[str, Any], key: str) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value:
        _invalid(f"snapshot {key} is invalid")
    return value


def _optional_text(row: Mapping[str, Any], key: str) -> None:
    value = row.get(key)
    if value is not None and not isinstance(value, str):
        _invalid(f"snapshot {key} is invalid")


def _integer(row: Mapping[str, Any], key: str, *, minimum: int) -> int:
    value = row.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        _invalid(f"snapshot {key} is invalid")
    return value


def _boolean(row: Mapping[str, Any], key: str) -> bool:
    value = row.get(key)
    if not isinstance(value, bool):
        _invalid(f"snapshot {key} is invalid")
    return value


def _invalid(
    message: str,
    details: dict[str, Any] | None = None,
    *,
    cause: Exception | None = None,
) -> NoReturn:
    error = DomainValidationError(message, code="snapshot_invalid", details=details)
    if cause is not None:
        raise error from cause
    raise error
