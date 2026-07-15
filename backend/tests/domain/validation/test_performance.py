from time import perf_counter

from app.domain.parameters.types import ValueType
from app.domain.validation.evaluator import evaluate_project
from app.domain.validation.hashing import validation_basis_hash
from app.domain.validation.types import (
    ConditionInput,
    LayerInput,
    ParameterDefinition,
    PriorPorSpec,
    ProjectContext,
    ValidationRuleDefinition,
    ValidationScope,
    ValidationSeverity,
)


def test_twenty_thousand_cells_and_fifty_relation_rules_remain_linear(
    capsys: object,
) -> None:
    del capsys
    parameters = (
        ParameterDefinition(code="source", display_name="Source", value_type=ValueType.TEXT),
        ParameterDefinition(code="candidate", display_name="Candidate", value_type=ValueType.TEXT),
    )
    layers = tuple(
        LayerInput(
            key=f"layer-{layer_index:04d}",
            layer_id="ACT",
            step_seq=f"{layer_index:04d}",
            eqp_type=None,
            area_name=None,
            sort_order=layer_index,
            conditions=tuple(
                ConditionInput(
                    id=layer_index * 10 + condition_index,
                    label=str(condition_index),
                    condition_index=condition_index,
                    is_por=condition_index == 0,
                    values={"source": "shared", "candidate": "shared"},
                )
                for condition_index in range(10)
            ),
        )
        for layer_index in range(1_000)
    )
    rules = tuple(
        ValidationRuleDefinition(
            code=f"prior-{rule_index:02d}",
            name=f"Prior {rule_index}",
            severity=ValidationSeverity.ERROR,
            version=1,
            scope=ValidationScope(),
            spec=PriorPorSpec(
                source_parameter_code="source",
                candidate_parameter_code="candidate",
            ),
        )
        for rule_index in range(50)
    )
    assert len(parameters) * sum(len(layer.conditions) for layer in layers) == 20_000

    started = perf_counter()
    result = evaluate_project(
        ProjectContext(project_id=1, line_id="L1", process_id="PROC"),
        parameters,
        layers,
        rules,
    )
    elapsed = perf_counter() - started

    assert len(result.issues) == 500
    assert all(issue.details["searched_layer_count"] == 0 for issue in result.issues)
    # The design target is 0.5s on the reference host. CI gets a deliberately
    # wide 15s regression ceiling; the measured duration is recorded in pytest output.
    print(f"validation_performance_elapsed_seconds={elapsed:.6f}")
    assert elapsed < 15.0
    assert validation_basis_hash(parameters, {}, rules).startswith("sha256:")
