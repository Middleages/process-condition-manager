"""Deterministic serialization for frozen parameter-registry inputs."""

import hashlib
import json
from collections.abc import Iterable, Mapping
from typing import Any

from app.domain.choices.constants import FIXED_PROFILE_CHOICE_SET_CODES
from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType
from app.domain.validation.hashing import validation_basis_hash
from app.domain.validation.types import (
    ChoiceDefinition,
    ParameterDefinition,
    PriorPorSpec,
    RequiredIfSpec,
    ValidationRuleDefinition,
    ValidationScope,
    canonical_typed_value,
)

SNAPSHOT_VERSION = 3


def snapshot(
    *,
    categories: Iterable[Mapping[str, Any]],
    parameters: Iterable[Mapping[str, Any]],
    choice_sets: Iterable[Mapping[str, Any]],
    validation_rules: Iterable[ValidationRuleDefinition] = (),
) -> dict[str, Any]:
    """Serialize the complete deterministic validation basis for approval reuse."""
    active_categories = sorted(
        (row for row in categories if row.get("is_active", True)),
        key=lambda row: (int(row.get("sort_order", 0)), str(row["code"])),
    )
    active_parameters = sorted(
        (row for row in parameters if row.get("is_active", True)),
        key=lambda row: (int(row.get("sort_order", 0)), str(row["code"])),
    )
    required_set_codes = set(FIXED_PROFILE_CHOICE_SET_CODES)
    required_set_codes.update(
        str(row["choice_set_code"])
        for row in active_parameters
        if _value_type(row["value_type"]) == "choice"
    )
    set_by_code = {str(row["code"]): row for row in choice_sets}
    missing = sorted(required_set_codes - set(set_by_code))
    if missing:
        raise RuleViolationError(
            f"snapshot ChoiceSet이 없다: {', '.join(missing)}",
            code="snapshot_choice_set_missing",
        )

    rules = tuple(validation_rules)
    parameter_definitions = tuple(
        _parameter_definition(row, set_by_code) for row in active_parameters
    )
    referenced_choice_set_codes = {
        parameter.choice_set_code
        for parameter in parameter_definitions
        if parameter.choice_set_code is not None
    }
    choice_set_versions = {
        code: int(set_by_code[code]["version"]) for code in referenced_choice_set_codes
    }
    # Validate the executable validation subset first. The persisted approval
    # digest below intentionally covers the complete frozen DefinitionView,
    # including presentation metadata and fixed Profile ChoiceSets.
    validation_basis_hash(
        parameter_definitions,
        choice_set_versions,
        rules,
    )
    parameters_by_code = {parameter.code: parameter for parameter in parameter_definitions}

    captured = {
        "version": SNAPSHOT_VERSION,
        "categories": [_category_out(row) for row in active_categories],
        "parameters": [_parameter_out(row) for row in active_parameters],
        "choice_sets": [_choice_set_out(set_by_code[code]) for code in sorted(required_set_codes)],
        "validation_rules": [
            _validation_rule_out(rule, parameters_by_code)
            for rule in sorted(rules, key=lambda item: item.code)
        ],
    }
    captured["validation_basis_hash"] = snapshot_digest(captured)
    return captured


def snapshot_digest(value: Mapping[str, Any]) -> str:
    """Digest the complete captured basis, excluding its self-referential hash."""
    payload = {key: item for key, item in value.items() if key != "validation_basis_hash"}
    canonical_json = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    )
    return "sha256:" + hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def _category_out(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "code": row["code"],
        "display_name": row["display_name"],
        "sort_order": int(row.get("sort_order", 0)),
    }


def _parameter_out(row: Mapping[str, Any]) -> dict[str, Any]:
    value_type = _value_type(row["value_type"])
    output = {
        "code": row["code"],
        "display_name": row["display_name"],
        "description": row.get("description"),
        "value_type": value_type,
        "category_code": row.get("category_code"),
        "unit": row.get("unit"),
        "min_value": _optional_string(row.get("min_value")),
        "max_value": _optional_string(row.get("max_value")),
        "required": bool(row.get("required", False)),
        "pattern": row.get("pattern"),
        "pattern_hint": row.get("pattern_hint"),
        "sort_order": int(row.get("sort_order", 0)),
    }
    if value_type == "choice":
        output["choice_set_code"] = str(row["choice_set_code"])
    return output


def _choice_set_out(row: Mapping[str, Any]) -> dict[str, Any]:
    options = sorted(
        row.get("options", []),
        key=lambda option: (int(option.get("sort_order", 0)), str(option["code"])),
    )
    return {
        "code": row["code"],
        "display_name": row["display_name"],
        "version": int(row["version"]),
        "is_active": bool(row.get("is_active", True)),
        "options": [_choice_option_out(option) for option in options],
    }


def _choice_option_out(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "code": row["code"],
        "label": row["label"],
        "sort_order": int(row.get("sort_order", 0)),
        "is_active": bool(row.get("is_active", True)),
    }


def _value_type(value: Any) -> str:
    return str(getattr(value, "value", value))


def _parameter_definition(
    row: Mapping[str, Any],
    choice_sets_by_code: Mapping[str, Mapping[str, Any]],
) -> ParameterDefinition:
    value_type = ValueType(_value_type(row["value_type"]))
    choice_set_code = str(row["choice_set_code"]) if value_type is ValueType.CHOICE else None
    choices: tuple[ChoiceDefinition, ...] = ()
    if choice_set_code is not None:
        choices = tuple(
            ChoiceDefinition(
                code=str(option["code"]),
                is_active=(
                    bool(choice_sets_by_code[choice_set_code].get("is_active", True))
                    and bool(option.get("is_active", True))
                ),
            )
            for option in choice_sets_by_code[choice_set_code].get("options", [])
        )
    return ParameterDefinition(
        code=str(row["code"]),
        display_name=str(row["display_name"]),
        value_type=value_type,
        required=bool(row.get("required", False)),
        pattern=_optional_string(row.get("pattern")),
        pattern_hint=_optional_string(row.get("pattern_hint")),
        min_value=_optional_string(row.get("min_value")),
        max_value=_optional_string(row.get("max_value")),
        choice_set_code=choice_set_code,
        choices=choices,
        sort_order=int(row.get("sort_order", 0)),
    )


def _validation_rule_out(
    rule: ValidationRuleDefinition,
    parameters_by_code: Mapping[str, ParameterDefinition],
) -> dict[str, Any]:
    if isinstance(rule.spec, RequiredIfSpec):
        when = parameters_by_code[rule.spec.when_parameter_code]
        equals = canonical_typed_value(when.value_type, rule.spec.equals)
        spec: dict[str, Any] = {
            "type": rule.spec.type.value,
            "schema_version": rule.spec.schema_version,
            "when_parameter_code": rule.spec.when_parameter_code,
            "equals": equals,
            "required_parameter_code": rule.spec.required_parameter_code,
        }
    elif isinstance(rule.spec, PriorPorSpec):
        spec = {
            "type": rule.spec.type.value,
            "schema_version": rule.spec.schema_version,
            "source_parameter_code": rule.spec.source_parameter_code,
            "candidate_parameter_code": rule.spec.candidate_parameter_code,
        }
    else:  # pragma: no cover - validation_basis_hash rejects unsupported specs first
        raise AssertionError("unsupported validation rule spec")
    return {
        "code": rule.code,
        "name": rule.name,
        "severity": rule.severity.value,
        "version": rule.version,
        "scope": _scope_out(rule.scope),
        "spec": spec,
    }


def _scope_out(scope: ValidationScope) -> dict[str, list[str]]:
    return {
        "line_ids": sorted(scope.line_ids),
        "process_ids": sorted(scope.process_ids),
        "layer_ids": sorted(scope.layer_ids),
        "step_seqs": sorted(scope.step_seqs),
        "eqp_types": sorted(scope.eqp_types),
        "area_names": sorted(scope.area_names),
    }


def _optional_string(value: Any) -> str | None:
    return None if value is None else str(value)
