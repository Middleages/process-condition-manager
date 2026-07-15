"""Immutable, framework-free inputs and outputs for project validation."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType

from app.domain.decimal_values import normalize_decimal
from app.domain.parameters.types import ValueType


class ValidationSeverity(StrEnum):
    ERROR = "error"
    WARNING = "warning"


class ValidationRuleType(StrEnum):
    REQUIRED_IF = "required_if"
    VALUE_EXISTS_IN_PRIOR_POR = "value_exists_in_prior_por"


@dataclass(frozen=True, slots=True)
class ChoiceDefinition:
    code: str
    is_active: bool


@dataclass(frozen=True, slots=True)
class ParameterDefinition:
    code: str
    display_name: str
    value_type: ValueType
    required: bool = False
    pattern: str | None = None
    pattern_hint: str | None = None
    min_value: str | None = None
    max_value: str | None = None
    choice_set_code: str | None = None
    choices: tuple[ChoiceDefinition, ...] = ()
    sort_order: int = 0


@dataclass(frozen=True, slots=True)
class ProjectContext:
    project_id: int
    line_id: str
    process_id: str


@dataclass(frozen=True, slots=True)
class ConditionInput:
    id: int
    label: str
    condition_index: int
    is_por: bool
    values: Mapping[str, str | None]

    def __post_init__(self) -> None:
        object.__setattr__(self, "values", MappingProxyType(dict(self.values)))


@dataclass(frozen=True, slots=True)
class LayerInput:
    key: str
    layer_id: str
    step_seq: str
    eqp_type: str | None
    area_name: str | None
    sort_order: int
    conditions: tuple[ConditionInput, ...]


@dataclass(frozen=True, slots=True)
class ValidationScope:
    line_ids: tuple[str, ...] = ()
    process_ids: tuple[str, ...] = ()
    layer_ids: tuple[str, ...] = ()
    step_seqs: tuple[str, ...] = ()
    eqp_types: tuple[str, ...] = ()
    area_names: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RequiredIfSpec:
    when_parameter_code: str
    equals: str
    required_parameter_code: str
    schema_version: int = 1
    type: ValidationRuleType = field(
        default=ValidationRuleType.REQUIRED_IF,
        init=False,
    )


@dataclass(frozen=True, slots=True)
class PriorPorSpec:
    source_parameter_code: str
    candidate_parameter_code: str
    schema_version: int = 1
    type: ValidationRuleType = field(
        default=ValidationRuleType.VALUE_EXISTS_IN_PRIOR_POR,
        init=False,
    )


type ValidationRuleSpec = RequiredIfSpec | PriorPorSpec


@dataclass(frozen=True, slots=True)
class ValidationRuleDefinition:
    code: str
    name: str
    severity: ValidationSeverity
    version: int
    scope: ValidationScope
    spec: ValidationRuleSpec


type IssueDetailValue = str | int | bool | None


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    key: str
    code: str
    rule_code: str | None
    rule_version: int | None
    severity: ValidationSeverity
    condition_id: int
    layer_key: str
    parameter_code: str
    details: Mapping[str, IssueDetailValue]

    def __post_init__(self) -> None:
        object.__setattr__(self, "details", MappingProxyType(dict(self.details)))

    def to_dict(self) -> dict[str, object]:
        return {
            "key": self.key,
            "code": self.code,
            "rule_code": self.rule_code,
            "rule_version": self.rule_version,
            "severity": self.severity.value,
            "condition_id": self.condition_id,
            "layer_key": self.layer_key,
            "parameter_code": self.parameter_code,
            "details": dict(self.details),
        }


@dataclass(frozen=True, slots=True)
class ValidationResult:
    issues: tuple[ValidationIssue, ...]

    @property
    def error_count(self) -> int:
        return sum(issue.severity is ValidationSeverity.ERROR for issue in self.issues)

    @property
    def warning_count(self) -> int:
        return sum(issue.severity is ValidationSeverity.WARNING for issue in self.issues)


def canonical_typed_value(value_type: ValueType, value: str | None) -> str | None:
    """Return the stable comparison identity for a stored typed value."""
    if value is None or value == "":
        return None
    if value_type is ValueType.NUMBER:
        return normalize_decimal(value)
    return value
