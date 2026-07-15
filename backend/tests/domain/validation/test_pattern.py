from dataclasses import FrozenInstanceError

import pytest

from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType
from app.domain.validation import (
    ChoiceDefinition,
    ConditionInput,
    LayerInput,
    ParameterDefinition,
    PriorPorSpec,
    ProjectContext,
    RequiredIfSpec,
    ValidationIssue,
    ValidationResult,
    ValidationRuleDefinition,
    ValidationScope,
    ValidationSeverity,
    canonical_typed_value,
    compile_portable_pattern,
)


@pytest.mark.parametrize(
    ("source", "accepted", "rejected"),
    [
        ("[A-Z]{2}-[0-9]{4}", ["AB-1234"], ["xAB-1234", "AB-1234\n"]),
        ("Y|N", ["Y", "N"], ["", "YN"]),
        ("[A-Za-z0-9_.-]{1,64}", ["a_b-1.txt"], ["한글"]),
        ("가|나|다", ["가", "나", "다"], ["라마"]),
    ],
)
def test_portable_pattern_fullmatches(
    source: str, accepted: list[str], rejected: list[str]
) -> None:
    compiled = compile_portable_pattern(source)

    assert all(compiled.fullmatch(value) for value in accepted)
    assert not any(compiled.fullmatch(value) for value in rejected)


def test_portable_pattern_supports_only_explicit_literal_escapes() -> None:
    compiled = compile_portable_pattern(r"\.\|\?\*\+\(\)\[\]\{\}\^\$\\")

    assert compiled.fullmatch(".|?*+()[]{}^$\\")
    assert compiled.max_match_length == 14


def test_portable_pattern_reports_the_longest_branch_and_rejects_long_values() -> None:
    compiled = compile_portable_pattern("A{2}|[0-9]{1,4}")

    assert compiled.max_match_length == 4
    assert not compiled.fullmatch("12345")


@pytest.mark.parametrize(
    "source",
    [
        "^A",
        "A$",
        "(AB)",
        "(?:AB)",
        "(?=A)A",
        "(?<=A)B",
        r"(A)\1",
        r"\d",
        r"\w",
        r"\s",
        r"\p{L}",
        "(?i)abc",
        "a*",
        "a+",
        "a{2,}",
        "a{3,2}",
        "[Z-A]",
        "|a",
        "a|",
        "[]",
        "[abc",
        "a{257}",
        "a{1,257}",
        "|".join(chr(0xAC00 + index) for index in range(17)),
        "a" * 65,
        "a?b?" * 8 + "c?",
        "a{256}b{256}c{256}d{256}e",
        "a?a{2}",
        "[A-Z]{1,2}[M-Z]?",
        ".{2}[0-9]?",
    ],
)
def test_portable_pattern_rejects_nonportable_or_over_complex_syntax(source: str) -> None:
    with pytest.raises(RuleViolationError) as caught:
        compile_portable_pattern(source)

    assert caught.value.code == "portable_pattern_invalid"
    assert str(caught.value)


def test_portable_pattern_accepts_complexity_boundaries() -> None:
    source = "|".join(chr(0xAC00 + index) for index in range(16))
    compiled = compile_portable_pattern(source)

    assert compiled.max_match_length == 1
    assert compiled.fullmatch("갏")
    assert compile_portable_pattern("a" * 64).max_match_length == 64
    assert compile_portable_pattern("a?b?" * 8).max_match_length == 16
    assert compile_portable_pattern("a{256}b{256}c{256}d{256}").max_match_length == 1024


@pytest.mark.parametrize(
    ("value_type", "raw", "expected"),
    [
        (ValueType.TEXT, " Text ", " Text "),
        (ValueType.CHOICE, "option_a", "option_a"),
        (ValueType.NUMBER, "-001.2300", "-1.23"),
        (ValueType.TEXT, None, None),
    ],
)
def test_canonical_typed_value_preserves_identity_or_normalizes_decimal(
    value_type: ValueType, raw: str | None, expected: str | None
) -> None:
    assert canonical_typed_value(value_type, raw) == expected


def test_validation_domain_values_are_frozen_and_slotted() -> None:
    choice = ChoiceDefinition(code="yes", is_active=True)
    parameter = ParameterDefinition(
        code="enabled",
        display_name="Enabled",
        value_type=ValueType.CHOICE,
        required=False,
        pattern=None,
        pattern_hint=None,
        min_value=None,
        max_value=None,
        choice_set_code="yes_no",
        choices=(choice,),
        sort_order=0,
    )
    condition = ConditionInput(
        id=1,
        label="POR",
        condition_index=0,
        is_por=True,
        values={"enabled": "yes"},
    )
    layer = LayerInput(
        key="layer-1",
        layer_id="ACT",
        step_seq="010",
        eqp_type="PHOTO",
        area_name="PHOTO",
        sort_order=0,
        conditions=(condition,),
    )
    scope = ValidationScope(line_ids=("L1",), layer_ids=("ACT",))
    required_spec = RequiredIfSpec(
        when_parameter_code="enabled",
        equals="yes",
        required_parameter_code="equipment",
    )
    prior_spec = PriorPorSpec(
        source_parameter_code="mask",
        candidate_parameter_code="previous_mask",
    )
    rule = ValidationRuleDefinition(
        code="equipment_required",
        name="Equipment required",
        severity=ValidationSeverity.ERROR,
        version=1,
        scope=scope,
        spec=required_spec,
    )
    issue = ValidationIssue(
        key="required:1:equipment",
        code="required_if",
        rule_code=rule.code,
        rule_version=rule.version,
        severity=ValidationSeverity.ERROR,
        condition_id=condition.id,
        layer_key=layer.key,
        parameter_code="equipment",
        details={"when_parameter_code": "enabled"},
    )
    result = ValidationResult(issues=(issue,))

    assert ProjectContext(project_id=1, line_id="L1", process_id="P1").line_id == "L1"
    assert prior_spec.schema_version == required_spec.schema_version == 1
    assert result.issues == (issue,)
    assert not hasattr(parameter, "__dict__")
    with pytest.raises(FrozenInstanceError):
        parameter.required = True  # type: ignore[misc]


def test_condition_values_snapshot_the_source_mapping_and_reject_item_assignment() -> None:
    source_values: dict[str, str | None] = {"enabled": "yes"}
    condition = ConditionInput(
        id=1,
        label="POR",
        condition_index=0,
        is_por=True,
        values=source_values,
    )

    source_values["enabled"] = "no"
    source_values["new"] = "value"

    assert dict(condition.values) == {"enabled": "yes"}
    with pytest.raises(TypeError):
        condition.values["enabled"] = "no"  # type: ignore[index]


def test_issue_details_snapshot_the_source_mapping_and_reject_item_assignment() -> None:
    source_details: dict[str, str | int | bool | None] = {"searched_layer_count": 2}
    issue = ValidationIssue(
        key="prior:1:mask",
        code="value_not_found_in_prior_por",
        rule_code="prior_mask",
        rule_version=1,
        severity=ValidationSeverity.ERROR,
        condition_id=1,
        layer_key="layer-1",
        parameter_code="mask",
        details=source_details,
    )

    source_details["searched_layer_count"] = 3
    source_details["candidate_parameter_code"] = "previous_mask"

    assert dict(issue.details) == {"searched_layer_count": 2}
    with pytest.raises(TypeError):
        issue.details["searched_layer_count"] = 3  # type: ignore[index]
