"""Canonical committed-project loading and whole-project validation orchestration."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import NoReturn

from pydantic import TypeAdapter, ValidationError

from app.core.errors import DomainValidationError, NotFoundError
from app.domain.decimal_values import normalize_decimal
from app.domain.errors import RuleViolationError
from app.domain.parameters.definition_view import DefinitionView
from app.domain.parameters.types import ValueType
from app.domain.validation import (
    ChoiceDefinition,
    ConditionInput,
    IssueDetailValue,
    LayerInput,
    ParameterDefinition,
    PriorPorSpec,
    ProjectContext,
    RequiredIfSpec,
    ValidationRuleDefinition,
    ValidationScope,
    ValidationSeverity,
    canonical_typed_value,
    evaluate_project,
    scope_applies_to_project,
    validation_basis_hash,
)
from app.features.sheets.repository import SheetRepository
from app.features.validation.schema import (
    PriorPorSpecIn,
    ProjectValidationOut,
    RequiredIfSpecIn,
    ValidationIssueOut,
    ValidationRuleSpecIn,
    ValidationScopeIn,
    ValidationSummaryOut,
)
from app.models.parameter import Parameter
from app.models.project import Project, ProjectStatus
from app.models.validation import ValidationRule

_SAFE_CONFIGURATION_MESSAGE = "검증 규칙을 불러오지 못했습니다. 관리자에게 확인을 요청해 주세요."
_SPEC_ADAPTER = TypeAdapter(ValidationRuleSpecIn)
_ISSUE_DETAIL_KEYS: dict[str, frozenset[str]] = {
    "required": frozenset(),
    "range_min": frozenset({"min_value", "max_value"}),
    "range_max": frozenset({"min_value", "max_value"}),
    "number_malformed": frozenset(),
    "pattern_mismatch": frozenset({"pattern_hint"}),
    "choice_unknown": frozenset(),
    "choice_inactive": frozenset(),
    "required_if": frozenset({"equals", "required_parameter_code", "when_parameter_code"}),
    "value_not_found_in_prior_por": frozenset({"candidate_parameter_code", "searched_layer_count"}),
}


@dataclass(frozen=True, slots=True)
class ApplicableRule:
    """One validated rule with project filters consumed and layer scope retained."""

    definition: ValidationRuleDefinition
    scope: dict[str, object]
    spec: ValidationRuleSpecIn


@dataclass(frozen=True, slots=True)
class CanonicalValidationBasis:
    """Single immutable definition/input load shared by Sheet and validation."""

    project: Project
    parameters: tuple[Parameter, ...]
    category_code_by_id: dict[int, str]
    context: ProjectContext
    parameter_definitions: tuple[ParameterDefinition, ...]
    layers: tuple[LayerInput, ...]
    rules: tuple[ApplicableRule, ...]
    basis_hash: str


class CanonicalValidationBasisLoader:
    """Load and defensively canonicalize the live committed validation basis."""

    def __init__(self, repo: SheetRepository) -> None:
        self.repo = repo

    async def load(self, project_id: int) -> CanonicalValidationBasis:
        project = await self.repo.load_project_tree(project_id)
        if project is None:
            raise NotFoundError(f"프로젝트를 찾을 수 없다: {project_id}")

        try:
            if project.status in {ProjectStatus.APPROVED, ProjectStatus.ARCHIVED}:
                return _build_frozen_basis(
                    project, DefinitionView.from_snapshot(project.parameter_snapshot)
                )
            parameters = tuple(await self.repo.list_active_parameters())
            categories = await self.repo.list_active_categories()
            persisted_rules = await self.repo.list_active_validation_rules()
            return _build_basis(
                project,
                parameters,
                {category.id: category.code for category in categories},
                persisted_rules,
            )
        except (
            DomainValidationError,
            RuleViolationError,
            ValidationError,
            LookupError,
            TypeError,
            ValueError,
        ) as exc:
            if isinstance(exc, DomainValidationError) and exc.code == "snapshot_invalid":
                raise
            _configuration_invalid(exc)


class ProjectValidationService:
    """Evaluate committed state without edit-lock or persistence coupling."""

    def __init__(self, repo: SheetRepository) -> None:
        self.loader = CanonicalValidationBasisLoader(repo)

    async def validate_project(self, project_id: int) -> ProjectValidationOut:
        basis = await self.loader.load(project_id)
        try:
            result = evaluate_project(
                basis.context,
                basis.parameter_definitions,
                basis.layers,
                tuple(rule.definition for rule in basis.rules),
            )
        except (RuleViolationError, TypeError, ValueError) as exc:
            _configuration_invalid(exc)

        return ProjectValidationOut(
            summary=ValidationSummaryOut(
                error_count=result.error_count,
                warning_count=result.warning_count,
            ),
            issues=[
                ValidationIssueOut(
                    key=issue.key,
                    code=issue.code,
                    rule_code=issue.rule_code,
                    rule_version=issue.rule_version,
                    severity=issue.severity,
                    condition_id=issue.condition_id,
                    layer_key=issue.layer_key,
                    parameter_code=issue.parameter_code,
                    details=_public_issue_details(issue.code, issue.details),
                )
                for issue in result.issues
            ],
            evaluated_at=datetime.now(UTC),
            basis_hash=basis.basis_hash,
            rule_versions={rule.definition.code: rule.definition.version for rule in basis.rules},
        )


def _configuration_invalid(cause: Exception | None = None) -> NoReturn:
    error = DomainValidationError(
        _SAFE_CONFIGURATION_MESSAGE,
        code="validation_configuration_invalid",
    )
    if cause is not None:
        raise error from cause
    raise error


def _public_issue_details(
    code: str,
    details: Mapping[str, IssueDetailValue],
) -> dict[str, IssueDetailValue]:
    allowed = _ISSUE_DETAIL_KEYS.get(code, frozenset())
    return {key: value for key, value in details.items() if key in allowed}


def _build_basis(
    project: Project,
    parameters: tuple[Parameter, ...],
    category_code_by_id: dict[int, str],
    persisted_rules: list[ValidationRule],
) -> CanonicalValidationBasis:
    context = ProjectContext(
        project_id=project.id,
        line_id=project.line_id,
        process_id=project.process_id,
    )
    parameter_definitions = tuple(_parameter_definition(parameter) for parameter in parameters)
    parameters_by_code = {parameter.code: parameter for parameter in parameter_definitions}
    layers = _layer_inputs(project)
    rules = tuple(
        projected
        for rule in persisted_rules
        if (projected := _applicable_rule(rule, context, parameters_by_code)) is not None
    )
    definitions = tuple(rule.definition for rule in rules)

    # Validate definitions without re-evaluating committed cells. This makes Sheet and
    # POST /validate fail closed on the same corrupt active configuration.
    evaluate_project(context, parameter_definitions, (), definitions)
    choice_set_versions = {
        parameter.choice_set.code: parameter.choice_set.version
        for parameter in parameters
        if parameter.value_type is ValueType.CHOICE and parameter.choice_set is not None
    }
    basis_hash = validation_basis_hash(
        parameter_definitions,
        choice_set_versions,
        definitions,
    )
    return CanonicalValidationBasis(
        project=project,
        parameters=parameters,
        category_code_by_id=category_code_by_id,
        context=context,
        parameter_definitions=parameter_definitions,
        layers=layers,
        rules=rules,
        basis_hash=basis_hash,
    )


def _build_frozen_basis(project: Project, view: DefinitionView) -> CanonicalValidationBasis:
    """Build validation inputs solely from the approved snapshot plus project rows."""
    definitions = view.parameter_definitions()
    raw_rules = view.rules()
    rule_definitions = view.validation_rule_definitions()
    rules = tuple(
        ApplicableRule(
            definition=definition,
            scope=dict(raw["scope"]),
            spec=_SPEC_ADAPTER.validate_python(raw["spec"]),
        )
        for raw, definition in zip(raw_rules, rule_definitions, strict=True)
    )
    context = ProjectContext(
        project_id=project.id,
        line_id=project.line_id,
        process_id=project.process_id,
    )
    # Structural corruption is rejected even for an empty project, matching the
    # live loader's fail-closed definition check.
    evaluate_project(context, definitions, (), rule_definitions)
    return CanonicalValidationBasis(
        project=project,
        parameters=(),
        category_code_by_id={},
        context=context,
        parameter_definitions=definitions,
        layers=_layer_inputs(project),
        rules=rules,
        basis_hash=view.validation_basis_hash,
    )


def _parameter_definition(parameter: Parameter) -> ParameterDefinition:
    """Project ORM metadata into the type-applicable canonical domain shape.

    Old PostgreSQL rows can predate NOT VALID number-metadata validation. Stale
    min/max/unit values on non-number parameters are deliberately ignored rather
    than turning an unrelated legacy row into a false configuration failure.
    """
    choice_set = parameter.choice_set if parameter.value_type is ValueType.CHOICE else None
    if parameter.value_type is ValueType.CHOICE and choice_set is None:
        raise RuleViolationError(
            "choice parameter has no choice set",
            code="validation_configuration_invalid",
        )

    return ParameterDefinition(
        code=parameter.code,
        display_name=parameter.display_name,
        value_type=parameter.value_type,
        required=parameter.required,
        pattern=parameter.pattern if parameter.value_type is ValueType.TEXT else None,
        pattern_hint=(parameter.pattern_hint if parameter.value_type is ValueType.TEXT else None),
        min_value=_bound(parameter.min_value) if parameter.value_type is ValueType.NUMBER else None,
        max_value=_bound(parameter.max_value) if parameter.value_type is ValueType.NUMBER else None,
        choice_set_code=choice_set.code if choice_set is not None else None,
        choices=(
            tuple(
                ChoiceDefinition(
                    code=option.code,
                    is_active=choice_set.is_active and option.is_active,
                )
                for option in choice_set.options
            )
            if choice_set is not None
            else ()
        ),
        sort_order=parameter.sort_order,
    )


def _bound(value: Decimal | None) -> str | None:
    return None if value is None else normalize_decimal(format(value, "f"))


def _layer_inputs(project: Project) -> tuple[LayerInput, ...]:
    return tuple(
        LayerInput(
            key=layer.layer_key,
            layer_id=layer.layer_id,
            step_seq=layer.step_seq,
            eqp_type=layer.eqp_type,
            area_name=layer.area_name,
            sort_order=layer.sort_order,
            conditions=tuple(
                ConditionInput(
                    id=condition.id,
                    label=condition.label,
                    condition_index=condition.condition_index,
                    is_por=condition.is_por,
                    values={cell.parameter_code: cell.value_text for cell in condition.cell_values},
                )
                for condition in sorted(
                    layer.conditions,
                    key=lambda item: (item.condition_index, item.id),
                )
            ),
        )
        for layer in sorted(project.layers, key=lambda item: (item.sort_order, item.layer_key))
    )


def _applicable_rule(
    rule: ValidationRule,
    context: ProjectContext,
    parameters_by_code: dict[str, ParameterDefinition],
) -> ApplicableRule | None:
    scope_in = ValidationScopeIn.model_validate(rule.scope)
    layers = scope_in.layers
    full_scope = ValidationScope(
        line_ids=tuple(sorted(scope_in.line_ids or ())),
        process_ids=tuple(sorted(scope_in.process_ids or ())),
        layer_ids=tuple(sorted(layers.layer_ids or ())) if layers is not None else (),
        step_seqs=tuple(sorted(layers.step_seqs or ())) if layers is not None else (),
        eqp_types=tuple(sorted(layers.eqp_types or ())) if layers is not None else (),
        area_names=tuple(sorted(layers.area_names or ())) if layers is not None else (),
    )
    spec_in = _SPEC_ADAPTER.validate_python(rule.spec)
    severity = ValidationSeverity(rule.severity)
    if isinstance(spec_in, RequiredIfSpecIn):
        when = parameters_by_code.get(spec_in.when_parameter_code)
        target = parameters_by_code.get(spec_in.required_parameter_code)
        if when is None or target is None:
            raise RuleViolationError(
                "rule references missing parameter",
                code="validation_configuration_invalid",
            )
        equals = canonical_typed_value(when.value_type, spec_in.equals)
        if equals is None:
            raise RuleViolationError(
                "rule has empty literal",
                code="validation_configuration_invalid",
            )
        if when.value_type is ValueType.CHOICE and equals not in {
            choice.code for choice in when.choices
        }:
            raise RuleViolationError(
                "rule has unknown choice literal",
                code="validation_configuration_invalid",
            )
        spec = RequiredIfSpec(
            when_parameter_code=spec_in.when_parameter_code,
            equals=equals,
            required_parameter_code=spec_in.required_parameter_code,
            schema_version=spec_in.schema_version,
        )
        projected_spec: ValidationRuleSpecIn = RequiredIfSpecIn(
            schema_version=spec_in.schema_version,
            type="required_if",
            when_parameter_code=spec_in.when_parameter_code,
            equals=equals,
            required_parameter_code=spec_in.required_parameter_code,
        )
    elif isinstance(spec_in, PriorPorSpecIn):
        source = parameters_by_code.get(spec_in.source_parameter_code)
        candidate = parameters_by_code.get(spec_in.candidate_parameter_code)
        if source is None or candidate is None:
            raise RuleViolationError(
                "rule references missing parameter",
                code="validation_configuration_invalid",
            )
        if source.value_type is not candidate.value_type:
            raise RuleViolationError(
                "rule references parameters with different types",
                code="validation_configuration_invalid",
            )
        if (
            source.value_type is ValueType.CHOICE
            and source.choice_set_code != candidate.choice_set_code
        ):
            raise RuleViolationError(
                "rule references different choice sets",
                code="validation_configuration_invalid",
            )
        spec = PriorPorSpec(
            source_parameter_code=spec_in.source_parameter_code,
            candidate_parameter_code=spec_in.candidate_parameter_code,
            schema_version=spec_in.schema_version,
        )
        projected_spec = spec_in
    else:  # pragma: no cover - discriminated adapter exhausts the union
        raise TypeError("unsupported validation rule")

    # Every active definition must be structurally and referentially sound even
    # when its project filters exclude this particular project. Corrupt rules
    # cannot use scope as a path to silently disappear.
    if not scope_applies_to_project(full_scope, context):
        return None

    # Project identity has now been consumed. Only current-layer filters remain.
    projected_scope = ValidationScope(
        layer_ids=full_scope.layer_ids,
        step_seqs=full_scope.step_seqs,
        eqp_types=full_scope.eqp_types,
        area_names=full_scope.area_names,
    )
    scope_payload = _layer_scope_payload(projected_scope)
    definition = ValidationRuleDefinition(
        code=rule.code,
        name=rule.name,
        severity=severity,
        version=rule.version,
        scope=projected_scope,
        spec=spec,
    )
    return ApplicableRule(
        definition=definition,
        scope=scope_payload,
        spec=projected_spec,
    )


def _layer_scope_payload(scope: ValidationScope) -> dict[str, object]:
    layers: dict[str, list[str]] = {}
    for field in ("layer_ids", "step_seqs", "eqp_types", "area_names"):
        values = getattr(scope, field)
        if values:
            layers[field] = list(values)
    return {"layers": layers} if layers else {}
