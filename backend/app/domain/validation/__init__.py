"""Portable validation domain contracts."""

from app.domain.validation.evaluator import evaluate_project
from app.domain.validation.hashing import validation_basis_hash
from app.domain.validation.pattern import PortablePattern, compile_portable_pattern
from app.domain.validation.scope import scope_applies_to_layer, scope_applies_to_project
from app.domain.validation.types import (
    ChoiceDefinition,
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
    ValidationRuleSpec,
    ValidationRuleType,
    ValidationScope,
    ValidationSeverity,
    canonical_typed_value,
)

__all__ = [
    "ChoiceDefinition",
    "ConditionInput",
    "IssueDetailValue",
    "LayerInput",
    "ParameterDefinition",
    "PortablePattern",
    "PriorPorSpec",
    "ProjectContext",
    "RequiredIfSpec",
    "ValidationIssue",
    "ValidationResult",
    "ValidationRuleDefinition",
    "ValidationRuleSpec",
    "ValidationRuleType",
    "ValidationScope",
    "ValidationSeverity",
    "canonical_typed_value",
    "compile_portable_pattern",
    "evaluate_project",
    "scope_applies_to_layer",
    "scope_applies_to_project",
    "validation_basis_hash",
]
