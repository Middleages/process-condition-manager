import json

import pytest

from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType
from app.domain.validation.evaluator import evaluate_project
from app.domain.validation.hashing import validation_basis_hash
from app.domain.validation.scope import scope_applies_to_layer, scope_applies_to_project
from app.domain.validation.types import (
    ChoiceDefinition,
    ConditionInput,
    LayerInput,
    ParameterDefinition,
    PriorPorSpec,
    ProjectContext,
    RequiredIfSpec,
    ValidationRuleDefinition,
    ValidationScope,
    ValidationSeverity,
)


def _parameter(
    code: str,
    value_type: ValueType,
    *,
    required: bool = False,
    pattern: str | None = None,
    pattern_hint: str | None = None,
    min_value: str | None = None,
    max_value: str | None = None,
    choice_set_code: str | None = None,
    choices: tuple[ChoiceDefinition, ...] = (),
    sort_order: int = 0,
) -> ParameterDefinition:
    return ParameterDefinition(
        code=code,
        display_name=code,
        value_type=value_type,
        required=required,
        pattern=pattern,
        pattern_hint=pattern_hint,
        min_value=min_value,
        max_value=max_value,
        choice_set_code=choice_set_code,
        choices=choices,
        sort_order=sort_order,
    )


def _condition(
    identifier: int,
    condition_index: int,
    values: dict[str, str | None],
    *,
    is_por: bool = False,
) -> ConditionInput:
    return ConditionInput(
        id=identifier,
        label=str(identifier),
        condition_index=condition_index,
        is_por=is_por,
        values=values,
    )


def _layer(
    key: str,
    sort_order: int,
    conditions: tuple[ConditionInput, ...],
    *,
    layer_id: str = "ACT",
    step_seq: str = "010",
    eqp_type: str | None = "PHOTO",
    area_name: str | None = "PHOTO",
) -> LayerInput:
    return LayerInput(
        key=key,
        layer_id=layer_id,
        step_seq=step_seq,
        eqp_type=eqp_type,
        area_name=area_name,
        sort_order=sort_order,
        conditions=conditions,
    )


def _prior_rule(
    *,
    code: str = "prior",
    scope: ValidationScope | None = None,
    source: str = "source",
    candidate: str = "candidate",
) -> ValidationRuleDefinition:
    return ValidationRuleDefinition(
        code=code,
        name=code,
        severity=ValidationSeverity.ERROR,
        version=3,
        scope=ValidationScope() if scope is None else scope,
        spec=PriorPorSpec(
            source_parameter_code=source,
            candidate_parameter_code=candidate,
        ),
    )


def test_standalone_rules_use_inclusive_decimal_and_typed_choice_semantics() -> None:
    parameters = (
        _parameter("required", ValueType.TEXT, required=True, sort_order=0),
        _parameter(
            "number",
            ValueType.NUMBER,
            min_value="-1.25",
            max_value="10.5",
            sort_order=1,
        ),
        _parameter(
            "pattern",
            ValueType.TEXT,
            pattern="[A-Z]{2}-[0-9]{4}",
            pattern_hint="AA-0000",
            sort_order=2,
        ),
        _parameter(
            "choice",
            ValueType.CHOICE,
            choice_set_code="choices",
            choices=(
                ChoiceDefinition(code="active", is_active=True),
                ChoiceDefinition(code="inactive", is_active=False),
            ),
            sort_order=3,
        ),
    )
    layer = _layer(
        "layer",
        0,
        (
            _condition(
                1,
                0,
                {
                    "required": None,
                    "number": "-1.2500",
                    "pattern": "AB-1234",
                    "choice": "active",
                },
            ),
            _condition(
                2,
                1,
                {
                    "required": "present",
                    "number": "10.500",
                    "pattern": "bad",
                    "choice": "inactive",
                },
            ),
            _condition(
                3,
                2,
                {
                    "required": "present",
                    "number": "broken",
                    "pattern": None,
                    "choice": "unknown",
                },
            ),
            _condition(
                4,
                3,
                {
                    "required": "present",
                    "number": "-1.2500000000000000000001",
                    "pattern": "ZZ-9999",
                    "choice": "active",
                },
            ),
            _condition(
                5,
                4,
                {
                    "required": "present",
                    "number": "10.5000000000000000000001",
                    "pattern": "ZZ-9999",
                    "choice": "active",
                },
            ),
        ),
    )

    result = evaluate_project(
        ProjectContext(project_id=1, line_id="L1", process_id="PROC"),
        parameters,
        (layer,),
        (),
    )

    assert [issue.code for issue in result.issues] == [
        "required",
        "pattern_mismatch",
        "number_malformed",
        "choice_unknown",
        "range_min",
        "range_max",
        "choice_inactive",
    ]
    assert result.error_count == 6
    assert result.warning_count == 1
    assert dict(result.issues[4].details) == {"max_value": "10.5", "min_value": "-1.25"}
    assert dict(result.issues[6].details) == {}


def test_required_if_uses_same_row_typed_equality_and_anchors_target() -> None:
    parameters = (
        _parameter("when", ValueType.NUMBER, sort_order=0),
        _parameter("target", ValueType.TEXT, sort_order=1),
    )
    layers = (
        _layer(
            "layer",
            0,
            (
                _condition(10, 0, {"when": "1.00", "target": None}),
                _condition(11, 1, {"when": "2", "target": None}),
                _condition(12, 2, {"when": None, "target": None}),
                _condition(13, 3, {"when": "1", "target": "present"}),
            ),
        ),
    )
    rule = ValidationRuleDefinition(
        code="target_when_one",
        name="target when one",
        severity=ValidationSeverity.WARNING,
        version=2,
        scope=ValidationScope(),
        spec=RequiredIfSpec(
            when_parameter_code="when",
            equals="1.0",
            required_parameter_code="target",
        ),
    )

    result = evaluate_project(
        ProjectContext(project_id=1, line_id="L1", process_id="PROC"),
        parameters,
        layers,
        (rule,),
    )

    assert len(result.issues) == 1
    issue = result.issues[0]
    assert issue.to_dict() == {
        "key": "required_if:target_when_one:2:10:target",
        "code": "required_if",
        "rule_code": "target_when_one",
        "rule_version": 2,
        "severity": "warning",
        "condition_id": 10,
        "layer_key": "layer",
        "parameter_code": "target",
        "details": {
            "equals": "1",
            "required_parameter_code": "target",
            "when_parameter_code": "when",
        },
    }


def test_prior_por_is_strictly_earlier_linear_membership_and_skips_empty_source() -> None:
    parameters = (
        _parameter("source", ValueType.TEXT, sort_order=0),
        _parameter("candidate", ValueType.TEXT, sort_order=1),
    )
    layers = (
        _layer(
            "layer-3",
            3,
            (
                _condition(31, 0, {"source": "B", "candidate": None}),
                _condition(32, 1, {"source": "C", "candidate": "C"}, is_por=True),
            ),
        ),
        _layer(
            "layer-1",
            1,
            (
                _condition(11, 0, {"source": "A", "candidate": "A"}, is_por=True),
                _condition(12, 1, {"source": "NONPOR", "candidate": "NONPOR"}),
                _condition(13, 2, {"source": "", "candidate": None}),
            ),
        ),
        _layer(
            "layer-4",
            4,
            (_condition(41, 0, {"source": "C", "candidate": None}),),
        ),
        _layer(
            "layer-2",
            2,
            (
                _condition(21, 0, {"source": "A", "candidate": None}),
                _condition(22, 1, {"source": "B", "candidate": "B"}, is_por=True),
            ),
        ),
    )

    result = evaluate_project(
        ProjectContext(project_id=1, line_id="L1", process_id="PROC"),
        parameters,
        layers,
        (_prior_rule(),),
    )

    issue_locations = [
        (issue.condition_id, issue.details["searched_layer_count"]) for issue in result.issues
    ]
    assert issue_locations == [(11, 0), (12, 0), (22, 1), (32, 2)]
    assert all(issue.parameter_code == "source" for issue in result.issues)


def test_prior_por_uses_canonical_decimal_identity() -> None:
    parameters = (
        _parameter("source", ValueType.NUMBER, sort_order=0),
        _parameter("candidate", ValueType.NUMBER, sort_order=1),
    )
    layers = (
        _layer(
            "earlier",
            0,
            (_condition(51, 0, {"source": None, "candidate": "01.200"}, is_por=True),),
        ),
        _layer(
            "current",
            1,
            (_condition(52, 0, {"source": "1.2", "candidate": None}),),
        ),
    )

    result = evaluate_project(
        ProjectContext(project_id=1, line_id="L1", process_id="PROC"),
        parameters,
        layers,
        (_prior_rule(),),
    )

    assert result.issues == ()


def test_scope_is_or_within_each_field_and_and_across_fields() -> None:
    context = ProjectContext(project_id=1, line_id="L1", process_id="PROC")
    matching = ValidationScope(
        line_ids=("OTHER", "L1"),
        process_ids=("OTHER", "PROC"),
        layer_ids=("GATE", "ACT"),
        step_seqs=("999", "010"),
        eqp_types=("ETCH", "PHOTO"),
        area_names=("DIFF", "PHOTO"),
    )
    layer = _layer("layer", 0, ())

    assert scope_applies_to_project(matching, context)
    assert scope_applies_to_layer(matching, layer)
    assert not scope_applies_to_project(
        ValidationScope(line_ids=("L1",), process_ids=("WRONG",)), context
    )
    assert not scope_applies_to_layer(
        ValidationScope(layer_ids=("ACT",), step_seqs=("WRONG",)), layer
    )
    assert not scope_applies_to_layer(
        ValidationScope(eqp_types=("PHOTO",)), _layer("none", 0, (), eqp_type=None)
    )
    assert not scope_applies_to_layer(
        ValidationScope(area_names=("PHOTO",)), _layer("none", 0, (), area_name=None)
    )


def test_prior_por_candidate_layers_are_not_filtered_by_current_layer_scope() -> None:
    parameters = (
        _parameter("source", ValueType.TEXT),
        _parameter("candidate", ValueType.TEXT),
    )
    layers = (
        _layer(
            "excluded-candidate",
            0,
            (_condition(1, 0, {"source": None, "candidate": "X"}, is_por=True),),
            layer_id="OTHER",
        ),
        _layer(
            "applicable",
            1,
            (_condition(2, 0, {"source": "X", "candidate": None}),),
            layer_id="ACT",
        ),
    )
    rule = _prior_rule(scope=ValidationScope(layer_ids=("ACT",)))

    result = evaluate_project(
        ProjectContext(project_id=1, line_id="L1", process_id="PROC"),
        parameters,
        layers,
        (rule,),
    )

    assert result.issues == ()


def test_input_permutations_produce_byte_identical_normalized_issues() -> None:
    parameters = (
        _parameter("target", ValueType.TEXT, required=True, sort_order=0),
        _parameter(
            "choice",
            ValueType.CHOICE,
            choice_set_code="choice",
            choices=(ChoiceDefinition("inactive", False),),
            sort_order=1,
        ),
    )
    conditions = (
        _condition(2, 1, {"target": "ok", "choice": "inactive"}),
        _condition(1, 0, {"target": None, "choice": None}),
    )
    layers = (
        _layer("later", 1, conditions),
        _layer("earlier", 0, tuple(reversed(conditions))),
    )
    context = ProjectContext(project_id=1, line_id="L1", process_id="PROC")

    first = evaluate_project(context, parameters, layers, ())
    second = evaluate_project(
        context,
        tuple(reversed(parameters)),
        tuple(reversed(layers)),
        (),
    )

    serialize = lambda result: json.dumps(  # noqa: E731
        [issue.to_dict() for issue in result.issues],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    assert serialize(first) == serialize(second)


@pytest.mark.parametrize(
    "parameters,rule",
    [
        (
            (_parameter("source", ValueType.TEXT),),
            _prior_rule(candidate="missing"),
        ),
        (
            (
                _parameter("source", ValueType.TEXT),
                _parameter("candidate", ValueType.NUMBER),
            ),
            _prior_rule(),
        ),
        (
            (
                _parameter("source", ValueType.CHOICE, choice_set_code="one"),
                _parameter("candidate", ValueType.CHOICE, choice_set_code="two"),
            ),
            _prior_rule(),
        ),
    ],
)
def test_invalid_relation_configuration_never_returns_false_success(
    parameters: tuple[ParameterDefinition, ...],
    rule: ValidationRuleDefinition,
) -> None:
    with pytest.raises(RuleViolationError) as caught:
        evaluate_project(
            ProjectContext(project_id=1, line_id="L1", process_id="PROC"),
            parameters,
            (),
            (rule,),
        )

    assert caught.value.code == "validation_configuration_invalid"


def test_basis_hash_is_canonical_and_definition_sensitive() -> None:
    choices = (
        ChoiceDefinition(code="b", is_active=False),
        ChoiceDefinition(code="a", is_active=True),
    )
    parameters = (
        _parameter(
            "choice",
            ValueType.CHOICE,
            choice_set_code="set",
            choices=choices,
            sort_order=1,
        ),
        _parameter("number", ValueType.NUMBER, min_value="01.00", sort_order=0),
    )
    rule = ValidationRuleDefinition(
        code="number_requires_choice",
        name="number requires choice",
        severity=ValidationSeverity.ERROR,
        version=3,
        scope=ValidationScope(
            line_ids=("L2", "L1"),
            layer_ids=("GATE", "ACT"),
        ),
        spec=RequiredIfSpec(
            when_parameter_code="number",
            equals="1.0",
            required_parameter_code="choice",
        ),
    )

    first = validation_basis_hash(parameters, {"set": 7}, (rule,))
    second = validation_basis_hash(
        tuple(reversed(parameters)),
        {"unrelated": 999, "set": 7},
        (
            ValidationRuleDefinition(
                code=rule.code,
                name=rule.name,
                severity=rule.severity,
                version=rule.version,
                scope=ValidationScope(line_ids=("L1", "L2"), layer_ids=("ACT", "GATE")),
                spec=rule.spec,
            ),
        ),
    )
    changed = validation_basis_hash(parameters, {"unrelated": 999, "set": 8}, (rule,))

    assert first == second
    assert first != changed
    assert first.startswith("sha256:")
    assert len(first) == len("sha256:") + 64


def test_basis_hash_requires_every_referenced_choice_set_version() -> None:
    parameters = (
        _parameter(
            "choice",
            ValueType.CHOICE,
            choice_set_code="required-set",
            choices=(ChoiceDefinition(code="active", is_active=True),),
        ),
    )

    with pytest.raises(RuleViolationError) as caught:
        validation_basis_hash(parameters, {}, ())

    assert caught.value.code == "validation_configuration_invalid"


@pytest.mark.parametrize("invalid_version", [0, -1, True, 1.5, "1"])
def test_basis_hash_requires_positive_integer_referenced_versions(
    invalid_version: object,
) -> None:
    parameters = (
        _parameter(
            "choice",
            ValueType.CHOICE,
            choice_set_code="required-set",
            choices=(ChoiceDefinition(code="active", is_active=True),),
        ),
    )

    with pytest.raises(RuleViolationError) as caught:
        validation_basis_hash(
            parameters,
            {"required-set": invalid_version},  # type: ignore[dict-item]
            (),
        )

    assert caught.value.code == "validation_configuration_invalid"
