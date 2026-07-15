import json
from pathlib import Path
from typing import Any

import pytest

from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType
from app.domain.validation.evaluator import evaluate_project
from app.domain.validation.pattern import compile_portable_pattern
from app.domain.validation.scope import scope_applies_to_layer
from app.domain.validation.types import (
    ChoiceDefinition,
    ConditionInput,
    LayerInput,
    ParameterDefinition,
    PriorPorSpec,
    ProjectContext,
    RequiredIfSpec,
    ValidationRuleDefinition,
    ValidationRuleType,
    ValidationScope,
    ValidationSeverity,
)

_REQUIRED_PATTERN_COVERAGE = frozenset(
    {
        "allowed_literal",
        "allowed_dot",
        "allowed_class",
        "allowed_range",
        "allowed_alternation",
        "allowed_optional",
        "allowed_exact_repetition",
        "allowed_bounded_repetition",
        "allowed_literal_escape",
        "forbidden_anchor_start",
        "forbidden_anchor_end",
        "forbidden_star",
        "forbidden_plus",
        "forbidden_capturing_group",
        "forbidden_noncapturing_group",
        "forbidden_lookahead",
        "forbidden_lookbehind",
        "forbidden_backreference",
        "forbidden_named_reference",
        "forbidden_inline_flags",
        "forbidden_shorthand_digit",
        "forbidden_shorthand_word",
        "forbidden_shorthand_space",
        "forbidden_shorthand_unicode_property",
        "forbidden_open_repetition",
        "forbidden_descending_repetition",
        "forbidden_out_of_range_repetition",
        "boundary_alternatives_16",
        "exceeded_alternatives_17",
        "boundary_atoms_64",
        "exceeded_atoms_65",
        "boundary_quantified_atoms_16",
        "exceeded_quantified_atoms_17",
        "boundary_repeat_256",
        "exceeded_repeat_257",
        "boundary_match_length_1024",
        "exceeded_match_length_1025",
        "forbidden_adjacent_quantifier_overlap",
        "final_newline_rejected",
        "unicode",
    }
)

_REQUIRED_EVALUATION_COVERAGE = frozenset(
    {
        "standalone_required_absent_present",
        "standalone_decimal_inclusive",
        "standalone_decimal_malformed",
        "standalone_pattern_mismatch",
        "standalone_choice_active_inactive_unknown",
        "required_if_y_true_false_absent",
        "prior_numeric_equality",
        "prior_first_layer_failure",
        "prior_no_por_exclusion",
        "prior_non_por_exclusion",
        "prior_empty_source_skip",
        "prior_strictly_earlier",
        "scope_line_ids",
        "scope_process_ids",
        "scope_layer_ids",
        "scope_step_seqs",
        "scope_eqp_types",
        "scope_area_names",
        "scope_or_within",
        "scope_and_across",
        "scope_exclusions",
        "configuration_type_incompatible",
        "configuration_choice_set_incompatible",
        "deterministic_permutation",
    }
)

_GOLDEN_PATH = (
    Path(__file__).parents[4]
    / "frontend"
    / "src"
    / "shared"
    / "domain"
    / "validation"
    / "golden-cases.json"
)


def _load_golden() -> dict[str, Any]:
    return json.loads(_GOLDEN_PATH.read_text(encoding="utf-8"))


def _parameter(raw: dict[str, Any]) -> ParameterDefinition:
    return ParameterDefinition(
        code=raw["code"],
        display_name=raw["display_name"],
        value_type=ValueType(raw["value_type"]),
        required=raw["required"],
        pattern=raw["pattern"],
        pattern_hint=raw["pattern_hint"],
        min_value=raw["min_value"],
        max_value=raw["max_value"],
        choice_set_code=raw["choice_set_code"],
        choices=tuple(
            ChoiceDefinition(code=choice["code"], is_active=choice["is_active"])
            for choice in raw["choices"]
        ),
        sort_order=raw["sort_order"],
    )


def _condition(raw: dict[str, Any]) -> ConditionInput:
    return ConditionInput(
        id=raw["id"],
        label=raw["label"],
        condition_index=raw["condition_index"],
        is_por=raw["is_por"],
        values=raw["values"],
    )


def _layer(raw: dict[str, Any]) -> LayerInput:
    return LayerInput(
        key=raw["key"],
        layer_id=raw["layer_id"],
        step_seq=raw["step_seq"],
        eqp_type=raw["eqp_type"],
        area_name=raw["area_name"],
        sort_order=raw["sort_order"],
        conditions=tuple(_condition(condition) for condition in raw["conditions"]),
    )


def _scope(raw: dict[str, Any]) -> ValidationScope:
    return ValidationScope(
        line_ids=tuple(raw["line_ids"]),
        process_ids=tuple(raw["process_ids"]),
        layer_ids=tuple(raw["layer_ids"]),
        step_seqs=tuple(raw["step_seqs"]),
        eqp_types=tuple(raw["eqp_types"]),
        area_names=tuple(raw["area_names"]),
    )


def _rule(raw: dict[str, Any]) -> ValidationRuleDefinition:
    raw_spec = raw["spec"]
    spec_type = ValidationRuleType(raw_spec["type"])
    if spec_type is ValidationRuleType.REQUIRED_IF:
        spec = RequiredIfSpec(
            when_parameter_code=raw_spec["when_parameter_code"],
            equals=raw_spec["equals"],
            required_parameter_code=raw_spec["required_parameter_code"],
            schema_version=raw_spec["schema_version"],
        )
    else:
        spec = PriorPorSpec(
            source_parameter_code=raw_spec["source_parameter_code"],
            candidate_parameter_code=raw_spec["candidate_parameter_code"],
            schema_version=raw_spec["schema_version"],
        )
    return ValidationRuleDefinition(
        code=raw["code"],
        name=raw["name"],
        severity=ValidationSeverity(raw["severity"]),
        version=raw["version"],
        scope=_scope(raw["scope"]),
        spec=spec,
    )


def _evaluate(vector: dict[str, Any]) -> str:
    raw_context = vector["context"]
    result = evaluate_project(
        ProjectContext(
            project_id=raw_context["project_id"],
            line_id=raw_context["line_id"],
            process_id=raw_context["process_id"],
        ),
        tuple(_parameter(parameter) for parameter in vector["parameters"]),
        tuple(_layer(layer) for layer in vector["layers"]),
        tuple(_rule(rule) for rule in vector["rules"]),
    )
    return json.dumps(
        [issue.to_dict() for issue in result.issues],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def test_golden_contract_has_shared_portable_top_level_shape() -> None:
    golden = _load_golden()

    assert set(golden) == {"pattern_vectors", "evaluation_vectors"}
    assert golden["pattern_vectors"]
    assert golden["evaluation_vectors"]
    # Importing scope in this shared-contract module guards the DB-free public boundary.
    first_layer = _layer(golden["evaluation_vectors"][0]["layers"][0])
    assert scope_applies_to_layer(ValidationScope(), first_layer)


def test_golden_contract_declares_every_required_shared_coverage_tag() -> None:
    golden = _load_golden()
    pattern_coverage = {
        tag for vector in golden["pattern_vectors"] for tag in vector.get("covers", [])
    }
    evaluation_coverage = {
        tag for vector in golden["evaluation_vectors"] for tag in vector.get("covers", [])
    }

    assert _REQUIRED_PATTERN_COVERAGE - pattern_coverage == set()
    assert _REQUIRED_EVALUATION_COVERAGE - evaluation_coverage == set()
    assert all(
        len(vector.get("covers", [])) == len(set(vector.get("covers", [])))
        for vector in golden["pattern_vectors"]
    )
    assert all(
        len(vector.get("covers", [])) == len(set(vector.get("covers", [])))
        for vector in golden["evaluation_vectors"]
    )


def test_pattern_golden_vectors() -> None:
    for vector in _load_golden()["pattern_vectors"]:
        if vector["valid"]:
            pattern = compile_portable_pattern(vector["source"])
            assert all(pattern.fullmatch(value) for value in vector["accepted"]), vector["name"]
            assert not any(pattern.fullmatch(value) for value in vector["rejected"]), vector["name"]
        else:
            with pytest.raises(RuleViolationError) as caught:
                compile_portable_pattern(vector["source"])
            assert caught.value.code == "portable_pattern_invalid", vector["name"]


def test_evaluation_golden_vectors_are_byte_exact_and_fully_typed() -> None:
    for vector in _load_golden()["evaluation_vectors"]:
        has_issues = "expected_issues" in vector
        has_error = "expected_error_code" in vector
        assert has_issues is not has_error, vector["name"]
        if has_error:
            with pytest.raises(RuleViolationError) as caught:
                _evaluate(vector)
            assert caught.value.code == vector["expected_error_code"], vector["name"]
            continue

        expected = vector["expected_issues"]
        for issue in expected:
            assert list(issue) == [
                "key",
                "code",
                "rule_code",
                "rule_version",
                "severity",
                "condition_id",
                "layer_key",
                "parameter_code",
                "details",
            ]
            assert all(
                value is None or isinstance(value, (str, int, bool))
                for value in issue["details"].values()
            )
        expected_json = json.dumps(expected, ensure_ascii=False, separators=(",", ":"))
        assert _evaluate(vector) == expected_json, vector["name"]


def test_equivalent_golden_input_permutations_are_byte_identical() -> None:
    grouped: dict[str, list[str]] = {}
    for vector in _load_golden()["evaluation_vectors"]:
        group = vector["equivalence_group"]
        if group is not None:
            grouped.setdefault(group, []).append(_evaluate(vector))

    assert grouped
    assert all(len(outputs) >= 2 for outputs in grouped.values())
    assert all(len(set(outputs)) == 1 for outputs in grouped.values())
