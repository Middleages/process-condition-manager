"""Create the isolated Phase 3 browser fixture and print its public identities as JSON."""

from __future__ import annotations

import asyncio
import json

from sqlalchemy import select

from app.core.db import AppSessionLocal
from app.domain.parameters.types import ValueType
from app.domain.validation.types import ValidationSeverity
from app.models.choice import ChoiceOption, ChoiceSet
from app.models.parameter import Parameter, ParameterCategory
from app.models.project import (
    CellValue,
    LayerCondition,
    Project,
    ProjectProfile,
    ProjectStatus,
    SheetLayer,
)
from app.models.validation import ValidationRule
from scripts.seed_dev import seed_managed_choices

CHOICE_SET_CODE = "qa_validation_choices"
PARAMETERS = (
    ("qa_required", "필수 입력", ValueType.TEXT, "qa_primary", 0),
    ("qa_range", "노광량", ValueType.NUMBER, "qa_primary", 1),
    ("qa_pattern", "마스크 형식", ValueType.TEXT, "qa_primary", 2),
    ("qa_trigger", "사용 여부", ValueType.TEXT, "qa_primary", 3),
    ("qa_candidate", "앞선 POR 마스크", ValueType.TEXT, "qa_primary", 4),
    ("qa_target", "추가 지침", ValueType.TEXT, "qa_hidden", 5),
    ("qa_source", "현재 마스크", ValueType.TEXT, "qa_hidden", 6),
    ("qa_choice", "장비 모드", ValueType.CHOICE, "qa_hidden", 7),
)


def values(*, layer: int, row: int) -> dict[str, str | None]:
    return {
        "qa_required": f"ready-{layer}-{row}",
        "qa_range": "15",
        "qa_pattern": "AB-1234",
        "qa_trigger": "N",
        "qa_candidate": "MASK-A" if layer == 1 and row == 1 else ("MASK-B" if layer == 2 and row == 1 else None),
        "qa_target": "configured",
        "qa_source": None if layer == 1 else "MASK-A",
        "qa_choice": "LEGACY" if layer == 1 and row == 1 else "ACTIVE",
    }


async def main() -> None:
    async with AppSessionLocal() as session:
        if await session.scalar(select(Project.id).where(Project.line_id == "QA-LINE")) is not None:
            raise RuntimeError("QA fixture already exists; the Compose database was not disposable")

        await seed_managed_choices(session)
        categories = {
            "qa_primary": ParameterCategory(
                code="qa_primary", display_name="QA 기본", sort_order=0
            ),
            "qa_hidden": ParameterCategory(
                code="qa_hidden", display_name="QA 숨김", sort_order=10
            ),
        }
        session.add_all(categories.values())

        choice_set = ChoiceSet(
            code=CHOICE_SET_CODE,
            display_name="QA Validation Choices",
            description="Task 9 browser-only deterministic fixture",
            version=1,
        )
        choice_set.options.extend(
            [
                ChoiceOption(code="ACTIVE", label="활성 장비", sort_order=10, is_active=True),
                ChoiceOption(code="LEGACY", label="기존 장비", sort_order=20, is_active=True),
            ]
        )
        session.add(choice_set)

        for code, display_name, value_type, category_code, sort_order in PARAMETERS:
            session.add(
                Parameter(
                    code=code,
                    display_name=display_name,
                    description=f"Task 9 fixture {code}",
                    value_type=value_type,
                    category=categories[category_code],
                    choice_set=choice_set if value_type is ValueType.CHOICE else None,
                    unit="mJ" if value_type is ValueType.NUMBER else None,
                    min_value=10 if value_type is ValueType.NUMBER else None,
                    max_value=20 if value_type is ValueType.NUMBER else None,
                    required=code == "qa_required",
                    pattern="[A-Z]{2}-[0-9]{4}" if code == "qa_pattern" else None,
                    pattern_hint="영문 대문자 2자리-숫자 4자리" if code == "qa_pattern" else None,
                    sort_order=sort_order,
                )
            )

        project = Project(
            line_id="QA-LINE",
            process_id="QA-PROC",
            part_id="QA-PART",
            name="Phase 3 validation browser fixture",
            status=ProjectStatus.DRAFT,
            profile=ProjectProfile(
                process_name="QA Validation Process",
                device_type_code="LOGIC",
                project_category_code="DEVELOPMENT",
                active_direction_code="FORWARD",
                gate_direction_code="UP",
                layer_total="2",
                comment="Isolated Task 9 browser fixture",
            ),
        )
        conditions: dict[str, LayerCondition] = {}
        for layer_number in (1, 2):
            layer = SheetLayer(
                layer_key=f"QA-LINE::QA-PROC::{layer_number * 10:03d}::QA{layer_number}",
                step_seq=f"{layer_number * 10:03d}",
                layer_id=f"QA{layer_number}",
                eqp_type="QA-EQP",
                eqp_type_desc="QA equipment",
                area_name="QA-AREA",
                sort_order=layer_number - 1,
            )
            for row_number in (1, 2):
                condition = LayerCondition(
                    label="POR" if row_number == 1 else "ALT",
                    condition_index=row_number,
                    is_por=row_number == 1,
                )
                condition.cell_values.extend(
                    CellValue(parameter_code=code, value_text=value)
                    for code, value in values(layer=layer_number, row=row_number).items()
                    if value is not None
                )
                layer.conditions.append(condition)
                conditions[f"l{layer_number}_r{row_number}"] = condition
            project.layers.append(layer)
        session.add(project)

        session.add_all(
            [
                ValidationRule(
                    code="qa_required_if",
                    name="QA required-if",
                    severity=ValidationSeverity.ERROR,
                    scope={},
                    spec={
                        "schema_version": 1,
                        "type": "required_if",
                        "when_parameter_code": "qa_trigger",
                        "equals": "Y",
                        "required_parameter_code": "qa_target",
                    },
                    version=1,
                    is_active=True,
                ),
                ValidationRule(
                    code="qa_prior_por",
                    name="QA prior POR",
                    severity=ValidationSeverity.ERROR,
                    scope={},
                    spec={
                        "schema_version": 1,
                        "type": "value_exists_in_prior_por",
                        "source_parameter_code": "qa_source",
                        "candidate_parameter_code": "qa_candidate",
                    },
                    version=1,
                    is_active=True,
                ),
            ]
        )
        await session.commit()

        print(
            json.dumps(
                {
                    "project_id": project.id,
                    "project_identity": {
                        "line_id": project.line_id,
                        "process_id": project.process_id,
                        "part_id": project.part_id,
                    },
                    "categories": ["qa_primary", "qa_hidden"],
                    "parameters": [item[0] for item in PARAMETERS],
                    "choice_set_code": CHOICE_SET_CODE,
                    "choice_set_version": choice_set.version,
                    "stored_choice_to_deactivate": "LEGACY",
                    "conditions": {key: value.id for key, value in conditions.items()},
                    "layers": [
                        {
                            "key": layer.layer_key,
                            "sort_order": layer.sort_order,
                            "por_condition_id": layer.conditions[0].id,
                        }
                        for layer in project.layers
                    ],
                    "rules": {"qa_required_if": 1, "qa_prior_por": 1},
                    "initial_state": "zero issues; LEGACY is stored and still active",
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    asyncio.run(main())
