"""Deterministic, database-free project validation."""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import NoReturn

from app.domain.decimal_values import normalize_decimal
from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType
from app.domain.validation.pattern import PortablePattern, compile_portable_pattern
from app.domain.validation.scope import scope_applies_to_layer, scope_applies_to_project
from app.domain.validation.types import (
    ConditionInput,
    IssueDetailValue,
    LayerInput,
    ParameterDefinition,
    PriorPorSpec,
    ProjectContext,
    RequiredIfSpec,
    ValidationIssue,
    ValidationResult,
    ValidationRuleDefinition,
    ValidationSeverity,
    canonical_typed_value,
)

_CONFIGURATION_INVALID = "validation_configuration_invalid"


@dataclass(frozen=True, slots=True)
class _PreparedParameter:
    definition: ParameterDefinition
    min_value: str | None
    max_value: str | None
    pattern: PortablePattern | None
    choices: dict[str, bool]


def _configuration_invalid(message: str) -> NoReturn:
    raise RuleViolationError(message, code=_CONFIGURATION_INVALID)


def _canonical_configuration_value(parameter: ParameterDefinition, value: str) -> str:
    try:
        canonical = canonical_typed_value(parameter.value_type, value)
    except RuleViolationError as exc:
        _configuration_invalid(f"invalid typed value for parameter {parameter.code}: {exc.code}")
    if canonical is None:
        _configuration_invalid(f"empty typed value for parameter {parameter.code}")
    return canonical


def _prepare_parameters(
    parameters: Sequence[ParameterDefinition],
) -> tuple[dict[str, _PreparedParameter], tuple[_PreparedParameter, ...]]:
    prepared_by_code: dict[str, _PreparedParameter] = {}
    for parameter in parameters:
        if parameter.code in prepared_by_code:
            _configuration_invalid(f"duplicate parameter code: {parameter.code}")

        min_value: str | None = None
        max_value: str | None = None
        pattern: PortablePattern | None = None
        choices: dict[str, bool] = {}

        if parameter.value_type is ValueType.NUMBER:
            if parameter.pattern is not None or parameter.pattern_hint is not None:
                _configuration_invalid(f"number parameter has pattern metadata: {parameter.code}")
            if parameter.choices or parameter.choice_set_code is not None:
                _configuration_invalid(f"number parameter has choice metadata: {parameter.code}")
            try:
                if parameter.min_value is not None:
                    min_value = normalize_decimal(parameter.min_value)
                if parameter.max_value is not None:
                    max_value = normalize_decimal(parameter.max_value)
            except RuleViolationError as exc:
                _configuration_invalid(f"invalid number bound for {parameter.code}: {exc.code}")
            if (
                min_value is not None
                and max_value is not None
                and Decimal(min_value) > Decimal(max_value)
            ):
                _configuration_invalid(f"descending number bounds for {parameter.code}")
        elif parameter.value_type is ValueType.TEXT:
            if parameter.min_value is not None or parameter.max_value is not None:
                _configuration_invalid(f"text parameter has number bounds: {parameter.code}")
            if parameter.choices or parameter.choice_set_code is not None:
                _configuration_invalid(f"text parameter has choice metadata: {parameter.code}")
            if (parameter.pattern is None) is not (parameter.pattern_hint is None):
                _configuration_invalid(f"text pattern metadata is incomplete: {parameter.code}")
            if parameter.pattern is not None:
                try:
                    pattern = compile_portable_pattern(parameter.pattern)
                except RuleViolationError as exc:
                    _configuration_invalid(f"invalid pattern for {parameter.code}: {exc.code}")
        elif parameter.value_type is ValueType.CHOICE:
            if parameter.min_value is not None or parameter.max_value is not None:
                _configuration_invalid(f"choice parameter has number bounds: {parameter.code}")
            if parameter.pattern is not None or parameter.pattern_hint is not None:
                _configuration_invalid(f"choice parameter has pattern metadata: {parameter.code}")
            if parameter.choice_set_code is None:
                _configuration_invalid(f"choice parameter has no choice set: {parameter.code}")
            for choice in parameter.choices:
                if choice.code in choices:
                    _configuration_invalid(
                        f"duplicate choice code for {parameter.code}: {choice.code}"
                    )
                choices[choice.code] = choice.is_active

        prepared = _PreparedParameter(
            definition=parameter,
            min_value=min_value,
            max_value=max_value,
            pattern=pattern,
            choices=choices,
        )
        prepared_by_code[parameter.code] = prepared

    ordered = tuple(
        sorted(
            prepared_by_code.values(),
            key=lambda item: (item.definition.sort_order, item.definition.code),
        )
    )
    return prepared_by_code, ordered


def _standalone_key(code: str, condition: ConditionInput, parameter_code: str) -> str:
    return f"{code}:{condition.id}:{parameter_code}"


def _relation_key(
    code: str,
    rule: ValidationRuleDefinition,
    condition: ConditionInput,
    parameter_code: str,
) -> str:
    return f"{code}:{rule.code}:{rule.version}:{condition.id}:{parameter_code}"


def _standalone_issue(
    code: str,
    condition: ConditionInput,
    layer: LayerInput,
    parameter_code: str,
    *,
    severity: ValidationSeverity = ValidationSeverity.ERROR,
    details: dict[str, IssueDetailValue] | None = None,
) -> ValidationIssue:
    return ValidationIssue(
        key=_standalone_key(code, condition, parameter_code),
        code=code,
        rule_code=None,
        rule_version=None,
        severity=severity,
        condition_id=condition.id,
        layer_key=layer.key,
        parameter_code=parameter_code,
        details={} if details is None else details,
    )


def _relation_issue(
    code: str,
    rule: ValidationRuleDefinition,
    condition: ConditionInput,
    layer: LayerInput,
    parameter_code: str,
    details: dict[str, IssueDetailValue],
) -> ValidationIssue:
    return ValidationIssue(
        key=_relation_key(code, rule, condition, parameter_code),
        code=code,
        rule_code=rule.code,
        rule_version=rule.version,
        severity=rule.severity,
        condition_id=condition.id,
        layer_key=layer.key,
        parameter_code=parameter_code,
        details=details,
    )


def _evaluate_standalone_cell(
    parameter: _PreparedParameter,
    layer: LayerInput,
    condition: ConditionInput,
    issues: list[ValidationIssue],
) -> None:
    definition = parameter.definition
    raw_value = condition.values.get(definition.code)
    if raw_value is None or raw_value == "":
        if definition.required:
            issues.append(_standalone_issue("required", condition, layer, definition.code))
        return

    if definition.value_type is ValueType.NUMBER:
        try:
            canonical = normalize_decimal(raw_value)
        except RuleViolationError:
            issues.append(_standalone_issue("number_malformed", condition, layer, definition.code))
            return
        numeric = Decimal(canonical)
        details: dict[str, IssueDetailValue] = {
            "max_value": parameter.max_value,
            "min_value": parameter.min_value,
        }
        if parameter.min_value is not None and numeric < Decimal(parameter.min_value):
            issues.append(
                _standalone_issue(
                    "range_min",
                    condition,
                    layer,
                    definition.code,
                    details=details,
                )
            )
        elif parameter.max_value is not None and numeric > Decimal(parameter.max_value):
            issues.append(
                _standalone_issue(
                    "range_max",
                    condition,
                    layer,
                    definition.code,
                    details=details,
                )
            )
        return

    if definition.value_type is ValueType.TEXT:
        if parameter.pattern is not None and not parameter.pattern.fullmatch(raw_value):
            issues.append(
                _standalone_issue(
                    "pattern_mismatch",
                    condition,
                    layer,
                    definition.code,
                    details={"pattern_hint": definition.pattern_hint},
                )
            )
        return

    active = parameter.choices.get(raw_value)
    if active is None:
        issues.append(_standalone_issue("choice_unknown", condition, layer, definition.code))
    elif not active:
        issues.append(
            _standalone_issue(
                "choice_inactive",
                condition,
                layer,
                definition.code,
                severity=ValidationSeverity.WARNING,
            )
        )


def _stored_typed_value(parameter: ParameterDefinition, raw_value: str | None) -> str | None:
    try:
        return canonical_typed_value(parameter.value_type, raw_value)
    except RuleViolationError:
        # Standalone validation owns malformed stored-number reporting. A malformed
        # value has no relation identity and therefore cannot trigger another issue.
        return None


def _require_parameter(
    prepared_by_code: dict[str, _PreparedParameter],
    code: str,
    rule: ValidationRuleDefinition,
) -> _PreparedParameter:
    parameter = prepared_by_code.get(code)
    if parameter is None:
        _configuration_invalid(f"rule {rule.code} references missing parameter {code}")
    return parameter


def _evaluate_required_if(
    rule: ValidationRuleDefinition,
    spec: RequiredIfSpec,
    prepared_by_code: dict[str, _PreparedParameter],
    ordered_layers: tuple[tuple[LayerInput, tuple[ConditionInput, ...]], ...],
    issues: list[ValidationIssue],
) -> None:
    if spec.schema_version != 1:
        _configuration_invalid(f"rule {rule.code} has unsupported schema version")
    when = _require_parameter(prepared_by_code, spec.when_parameter_code, rule)
    _require_parameter(prepared_by_code, spec.required_parameter_code, rule)
    equals = _canonical_configuration_value(when.definition, spec.equals)
    if when.definition.value_type is ValueType.CHOICE and equals not in when.choices:
        _configuration_invalid(f"rule {rule.code} has unknown choice literal")

    for layer, conditions in ordered_layers:
        if not scope_applies_to_layer(rule.scope, layer):
            continue
        for condition in conditions:
            current = _stored_typed_value(
                when.definition,
                condition.values.get(spec.when_parameter_code),
            )
            if current != equals:
                continue
            target = condition.values.get(spec.required_parameter_code)
            if target is not None and target != "":
                continue
            issues.append(
                _relation_issue(
                    "required_if",
                    rule,
                    condition,
                    layer,
                    spec.required_parameter_code,
                    {
                        "equals": equals,
                        "required_parameter_code": spec.required_parameter_code,
                        "when_parameter_code": spec.when_parameter_code,
                    },
                )
            )


def _evaluate_prior_por(
    rule: ValidationRuleDefinition,
    spec: PriorPorSpec,
    prepared_by_code: dict[str, _PreparedParameter],
    ordered_layers: tuple[tuple[LayerInput, tuple[ConditionInput, ...]], ...],
    issues: list[ValidationIssue],
) -> None:
    if spec.schema_version != 1:
        _configuration_invalid(f"rule {rule.code} has unsupported schema version")
    source = _require_parameter(prepared_by_code, spec.source_parameter_code, rule)
    candidate = _require_parameter(prepared_by_code, spec.candidate_parameter_code, rule)
    if source.definition.value_type is not candidate.definition.value_type:
        _configuration_invalid(f"rule {rule.code} references parameters with different types")
    if (
        source.definition.value_type is ValueType.CHOICE
        and source.definition.choice_set_code != candidate.definition.choice_set_code
    ):
        _configuration_invalid(f"rule {rule.code} references different choice sets")

    prior_candidates: set[str] = set()
    searched_layer_count = 0
    for layer, conditions in ordered_layers:
        if scope_applies_to_layer(rule.scope, layer):
            for condition in conditions:
                current = _stored_typed_value(
                    source.definition,
                    condition.values.get(spec.source_parameter_code),
                )
                if current is not None and current not in prior_candidates:
                    issues.append(
                        _relation_issue(
                            "value_not_found_in_prior_por",
                            rule,
                            condition,
                            layer,
                            spec.source_parameter_code,
                            {
                                "candidate_parameter_code": spec.candidate_parameter_code,
                                "searched_layer_count": searched_layer_count,
                            },
                        )
                    )

        por = next((condition for condition in conditions if condition.is_por), None)
        if por is not None:
            current_candidate = _stored_typed_value(
                candidate.definition,
                por.values.get(spec.candidate_parameter_code),
            )
            if current_candidate is not None:
                prior_candidates.add(current_candidate)
        searched_layer_count += 1


def evaluate_project(
    context: ProjectContext,
    parameters: Sequence[ParameterDefinition],
    layers: Sequence[LayerInput],
    rules: Sequence[ValidationRuleDefinition],
) -> ValidationResult:
    """Evaluate every applicable standalone and relation rule deterministically."""
    prepared_by_code, ordered_parameters = _prepare_parameters(parameters)

    if len({layer.key for layer in layers}) != len(layers):
        _configuration_invalid("duplicate layer key")
    ordered_layers = tuple(
        (
            layer,
            tuple(sorted(layer.conditions, key=lambda row: (row.condition_index, row.id))),
        )
        for layer in sorted(layers, key=lambda item: (item.sort_order, item.key))
    )

    issues: list[ValidationIssue] = []
    for layer, conditions in ordered_layers:
        for condition in conditions:
            for parameter in ordered_parameters:
                _evaluate_standalone_cell(parameter, layer, condition, issues)

    seen_rule_codes: set[str] = set()
    for rule in sorted(rules, key=lambda item: (item.code, item.version)):
        if rule.code in seen_rule_codes:
            _configuration_invalid(f"duplicate rule code: {rule.code}")
        seen_rule_codes.add(rule.code)
        if not scope_applies_to_project(rule.scope, context):
            continue
        if isinstance(rule.spec, RequiredIfSpec):
            _evaluate_required_if(
                rule,
                rule.spec,
                prepared_by_code,
                ordered_layers,
                issues,
            )
        elif isinstance(rule.spec, PriorPorSpec):
            _evaluate_prior_por(
                rule,
                rule.spec,
                prepared_by_code,
                ordered_layers,
                issues,
            )
        else:
            _configuration_invalid(f"rule {rule.code} has an unsupported spec")

    layer_rank = {layer.key: rank for rank, (layer, _) in enumerate(ordered_layers)}
    condition_rank = {
        (layer.key, condition.id): (condition.condition_index, condition.id)
        for layer, conditions in ordered_layers
        for condition in conditions
    }
    parameter_rank = {
        parameter.definition.code: (
            parameter.definition.sort_order,
            parameter.definition.code,
        )
        for parameter in ordered_parameters
    }
    severity_rank = {
        ValidationSeverity.ERROR: 0,
        ValidationSeverity.WARNING: 1,
    }
    issues.sort(
        key=lambda issue: (
            severity_rank[issue.severity],
            layer_rank[issue.layer_key],
            condition_rank[(issue.layer_key, issue.condition_id)],
            parameter_rank[issue.parameter_code],
            issue.rule_code or "",
            issue.rule_version if issue.rule_version is not None else -1,
            issue.key,
        )
    )
    return ValidationResult(issues=tuple(issues))
