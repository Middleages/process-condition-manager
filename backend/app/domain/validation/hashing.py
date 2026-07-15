"""Canonical validation-definition hashing."""

import hashlib
import json
from collections.abc import Mapping, Sequence
from typing import NoReturn

from app.domain.decimal_values import normalize_decimal
from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType
from app.domain.validation.types import (
    ParameterDefinition,
    PriorPorSpec,
    RequiredIfSpec,
    ValidationRuleDefinition,
    ValidationScope,
    canonical_typed_value,
)

_CONFIGURATION_INVALID = "validation_configuration_invalid"


def _configuration_invalid(message: str) -> NoReturn:
    raise RuleViolationError(message, code=_CONFIGURATION_INVALID)


def _canonical_bound(value: str | None, parameter_code: str) -> str | None:
    if value is None:
        return None
    try:
        return normalize_decimal(value)
    except RuleViolationError as exc:
        _configuration_invalid(f"invalid number bound for {parameter_code}: {exc.code}")


def _canonical_scope(scope: ValidationScope) -> dict[str, list[str]]:
    return {
        "area_names": sorted(scope.area_names),
        "eqp_types": sorted(scope.eqp_types),
        "layer_ids": sorted(scope.layer_ids),
        "line_ids": sorted(scope.line_ids),
        "process_ids": sorted(scope.process_ids),
        "step_seqs": sorted(scope.step_seqs),
    }


def _canonical_parameter(parameter: ParameterDefinition) -> dict[str, object]:
    return {
        "choice_set_code": parameter.choice_set_code,
        "choices": [
            {"code": choice.code, "is_active": choice.is_active}
            for choice in sorted(parameter.choices, key=lambda item: item.code)
        ],
        "code": parameter.code,
        "display_name": parameter.display_name,
        "max_value": _canonical_bound(parameter.max_value, parameter.code),
        "min_value": _canonical_bound(parameter.min_value, parameter.code),
        "pattern": parameter.pattern,
        "pattern_hint": parameter.pattern_hint,
        "required": parameter.required,
        "sort_order": parameter.sort_order,
        "value_type": parameter.value_type.value,
    }


def _required_if_spec(
    rule: ValidationRuleDefinition,
    spec: RequiredIfSpec,
    parameters_by_code: Mapping[str, ParameterDefinition],
) -> dict[str, object]:
    when = parameters_by_code.get(spec.when_parameter_code)
    target = parameters_by_code.get(spec.required_parameter_code)
    if when is None or target is None:
        _configuration_invalid(f"rule {rule.code} references a missing parameter")
    if spec.schema_version != 1:
        _configuration_invalid(f"rule {rule.code} has unsupported schema version")
    try:
        equals = canonical_typed_value(when.value_type, spec.equals)
    except RuleViolationError as exc:
        _configuration_invalid(f"rule {rule.code} has invalid literal: {exc.code}")
    if equals is None:
        _configuration_invalid(f"rule {rule.code} has an empty literal")
    if when.value_type is ValueType.CHOICE and equals not in {
        choice.code for choice in when.choices
    }:
        _configuration_invalid(f"rule {rule.code} has an unknown choice literal")
    return {
        "equals": equals,
        "required_parameter_code": spec.required_parameter_code,
        "schema_version": spec.schema_version,
        "type": spec.type.value,
        "when_parameter_code": spec.when_parameter_code,
    }


def _prior_por_spec(
    rule: ValidationRuleDefinition,
    spec: PriorPorSpec,
    parameters_by_code: Mapping[str, ParameterDefinition],
) -> dict[str, object]:
    source = parameters_by_code.get(spec.source_parameter_code)
    candidate = parameters_by_code.get(spec.candidate_parameter_code)
    if source is None or candidate is None:
        _configuration_invalid(f"rule {rule.code} references a missing parameter")
    if spec.schema_version != 1:
        _configuration_invalid(f"rule {rule.code} has unsupported schema version")
    if source.value_type is not candidate.value_type:
        _configuration_invalid(f"rule {rule.code} references parameters with different types")
    if (
        source.value_type is ValueType.CHOICE
        and source.choice_set_code != candidate.choice_set_code
    ):
        _configuration_invalid(f"rule {rule.code} references different choice sets")
    return {
        "candidate_parameter_code": spec.candidate_parameter_code,
        "schema_version": spec.schema_version,
        "source_parameter_code": spec.source_parameter_code,
        "type": spec.type.value,
    }


def _canonical_rule(
    rule: ValidationRuleDefinition,
    parameters_by_code: Mapping[str, ParameterDefinition],
) -> dict[str, object]:
    if isinstance(rule.spec, RequiredIfSpec):
        spec = _required_if_spec(rule, rule.spec, parameters_by_code)
    elif isinstance(rule.spec, PriorPorSpec):
        spec = _prior_por_spec(rule, rule.spec, parameters_by_code)
    else:
        _configuration_invalid(f"rule {rule.code} has an unsupported spec")
    return {
        "code": rule.code,
        "name": rule.name,
        "scope": _canonical_scope(rule.scope),
        "severity": rule.severity.value,
        "spec": spec,
        "version": rule.version,
    }


def validation_basis_hash(
    parameters: Sequence[ParameterDefinition],
    choice_set_versions: Mapping[str, int],
    rules: Sequence[ValidationRuleDefinition],
) -> str:
    """Hash canonical validation definitions, independent of input ordering."""
    parameters_by_code = {parameter.code: parameter for parameter in parameters}
    if len(parameters_by_code) != len(parameters):
        _configuration_invalid("duplicate parameter code")
    if len({rule.code for rule in rules}) != len(rules):
        _configuration_invalid("duplicate rule code")

    referenced_choice_sets: set[str] = set()
    for parameter in parameters:
        if parameter.value_type is not ValueType.CHOICE:
            continue
        if parameter.choice_set_code is None:
            _configuration_invalid(
                f"choice parameter {parameter.code} has no referenced choice set"
            )
        referenced_choice_sets.add(parameter.choice_set_code)

    canonical_choice_set_versions: list[dict[str, object]] = []
    for code in sorted(referenced_choice_sets):
        if code not in choice_set_versions:
            _configuration_invalid(f"missing choice set version: {code}")
        version = choice_set_versions[code]
        if isinstance(version, bool) or not isinstance(version, int) or version <= 0:
            _configuration_invalid(f"invalid choice set version: {code}")
        canonical_choice_set_versions.append({"code": code, "version": version})

    payload = {
        "choice_set_versions": canonical_choice_set_versions,
        "parameters": [
            _canonical_parameter(parameter)
            for parameter in sorted(parameters, key=lambda item: item.code)
        ],
        "rules": [
            _canonical_rule(rule, parameters_by_code)
            for rule in sorted(rules, key=lambda item: (item.code, item.version))
        ],
    }
    canonical_json = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    digest = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"
