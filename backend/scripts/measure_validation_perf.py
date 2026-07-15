"""Deterministic, database-free whole-project validation measurement."""

from __future__ import annotations

import argparse
import math
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path

# The task's reproducible command executes this file directly rather than with
# ``python -m``; make the backend package root explicit without installing it.
if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.parameters.types import ValueType  # noqa: E402
from app.domain.validation import (  # noqa: E402
    ChoiceDefinition,
    ConditionInput,
    LayerInput,
    ParameterDefinition,
    PriorPorSpec,
    ProjectContext,
    ValidationRuleDefinition,
    ValidationScope,
    ValidationSeverity,
    evaluate_project,
)

_PARAMETER_COUNT = 20
_MAX_LAYERS = 100


@dataclass(frozen=True, slots=True)
class ValidationFixture:
    context: ProjectContext
    parameters: tuple[ParameterDefinition, ...]
    layers: tuple[LayerInput, ...]
    rules: tuple[ValidationRuleDefinition, ...]
    cell_count: int


@dataclass(frozen=True, slots=True)
class ValidationMeasurement:
    cell_count: int
    rule_count: int
    samples: int
    median_ms: float
    p95_ms: float
    error_count: int
    warning_count: int
    issue_count: int


def build_fixture(*, cell_count: int, rule_count: int) -> ValidationFixture:
    """Build a fixed-shape domain fixture with exactly ``cell_count`` grid cells."""
    if cell_count <= 0 or cell_count % _PARAMETER_COUNT != 0:
        raise ValueError(f"cells must be a positive multiple of {_PARAMETER_COUNT}")
    if rule_count < 0:
        raise ValueError("rules must be non-negative")

    condition_count = cell_count // _PARAMETER_COUNT
    layer_count = min(_MAX_LAYERS, condition_count)
    parameters = _parameters()
    conditions_by_layer: list[list[ConditionInput]] = [[] for _ in range(layer_count)]
    for offset in range(condition_count):
        layer_index = min(offset * layer_count // condition_count, layer_count - 1)
        condition_index = len(conditions_by_layer[layer_index]) + 1
        values: dict[str, str | None] = {
            "source": "missing" if layer_index == 0 else f"candidate-{layer_index - 1}",
            "candidate": f"candidate-{layer_index}",
            "required_text": None if offset % 10 == 0 else "present",
            "bounded_number": "25" if offset % 10 == 1 else "15",
            "managed_choice": "inactive" if offset % 10 == 2 else "active",
        }
        values.update({f"text_{index:02d}": "value" for index in range(15)})
        conditions_by_layer[layer_index].append(
            ConditionInput(
                id=offset + 1,
                label="base" if condition_index == 1 else f"C{condition_index}",
                condition_index=condition_index,
                is_por=condition_index == 1,
                values=values,
            )
        )

    layers = tuple(
        LayerInput(
            key=f"L1::PERF::{index:03d}::ACT",
            layer_id="ACT",
            step_seq=f"{index:03d}",
            eqp_type="PHOTO",
            area_name="PHOTO",
            sort_order=index,
            conditions=tuple(conditions),
        )
        for index, conditions in enumerate(conditions_by_layer)
    )
    rules = tuple(
        ValidationRuleDefinition(
            code=f"prior_value_{index:03d}",
            name=f"Prior value {index}",
            severity=(
                ValidationSeverity.ERROR
                if index % 2 == 0
                else ValidationSeverity.WARNING
            ),
            version=1,
            scope=ValidationScope(layer_ids=("ACT",)),
            spec=PriorPorSpec(
                source_parameter_code="source",
                candidate_parameter_code="candidate",
            ),
        )
        for index in range(rule_count)
    )
    return ValidationFixture(
        context=ProjectContext(project_id=1, line_id="L1", process_id="PERF"),
        parameters=parameters,
        layers=layers,
        rules=rules,
        cell_count=cell_count,
    )


def _parameters() -> tuple[ParameterDefinition, ...]:
    base = (
        ParameterDefinition("source", "Source", ValueType.TEXT, sort_order=0),
        ParameterDefinition("candidate", "Candidate", ValueType.TEXT, sort_order=1),
        ParameterDefinition(
            "required_text",
            "Required",
            ValueType.TEXT,
            required=True,
            sort_order=2,
        ),
        ParameterDefinition(
            "bounded_number",
            "Bounded number",
            ValueType.NUMBER,
            min_value="10",
            max_value="20",
            sort_order=3,
        ),
        ParameterDefinition(
            "managed_choice",
            "Managed choice",
            ValueType.CHOICE,
            choice_set_code="perf_choices",
            choices=(
                ChoiceDefinition(code="active", is_active=True),
                ChoiceDefinition(code="inactive", is_active=False),
            ),
            sort_order=4,
        ),
    )
    filler = tuple(
        ParameterDefinition(
            code=f"text_{index:02d}",
            display_name=f"Text {index}",
            value_type=ValueType.TEXT,
            sort_order=index + len(base),
        )
        for index in range(15)
    )
    return base + filler


def measure_samples(
    *,
    cell_count: int,
    rule_count: int,
    samples: int,
) -> ValidationMeasurement:
    if samples <= 0:
        raise ValueError("samples must be positive")
    fixture = build_fixture(cell_count=cell_count, rule_count=rule_count)
    evaluate_project(
        fixture.context,
        fixture.parameters,
        fixture.layers,
        fixture.rules,
    )

    durations: list[float] = []
    error_count = warning_count = issue_count = 0
    for _ in range(samples):
        started = time.perf_counter()
        result = evaluate_project(
            fixture.context,
            fixture.parameters,
            fixture.layers,
            fixture.rules,
        )
        durations.append((time.perf_counter() - started) * 1000)
        error_count = result.error_count
        warning_count = result.warning_count
        issue_count = len(result.issues)

    ordered = sorted(durations)
    p95_index = max(0, math.ceil(0.95 * len(ordered)) - 1)
    return ValidationMeasurement(
        cell_count=cell_count,
        rule_count=rule_count,
        samples=samples,
        median_ms=statistics.median(ordered),
        p95_ms=ordered[p95_index],
        error_count=error_count,
        warning_count=warning_count,
        issue_count=issue_count,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cells", type=int, default=20_000)
    parser.add_argument("--rules", type=int, default=50)
    parser.add_argument("--samples", type=int, default=3)
    args = parser.parse_args()
    measured = measure_samples(
        cell_count=args.cells,
        rule_count=args.rules,
        samples=args.samples,
    )

    print("=== Database-free project validation performance ===")
    print(f"cells: {measured.cell_count}")
    print(f"rules: {measured.rule_count}")
    print(f"samples: {measured.samples}")
    print(f"median_ms: {measured.median_ms:.3f}")
    print(f"p95_ms: {measured.p95_ms:.3f}")
    print(f"error_count: {measured.error_count}")
    print(f"warning_count: {measured.warning_count}")
    print(f"issue_count: {measured.issue_count}")


if __name__ == "__main__":
    main()
