"""Seed a representative managed-choice registry and a large development sheet.

Normal execution expects ``alembic upgrade head`` to have created the four fixed
Project Profile ChoiceSet identities.  ``seed_managed_choices(create_fixed_sets=True)``
is reserved for SQLite performance measurement, where metadata is created directly.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.parameters.types import ValueType
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

_CATEGORY_CODES = ("photo", "etch", "clean", "depo", "cmp", "metro")
_VALUE_TYPES = (ValueType.NUMBER, ValueType.TEXT, ValueType.CHOICE)
_FIXED_SET_DEFINITIONS = {
    "device_type": (
        "Device Type",
        (("LOGIC", "Logic", True), ("MEMORY_LEGACY", "Memory (legacy)", False)),
    ),
    "project_category": (
        "Project Category",
        (("DEVELOPMENT", "Development", True), ("LEGACY_PROJECT", "Legacy", False)),
    ),
    "active_direction": (
        "Active Direction",
        (("FORWARD", "Forward", True), ("REVERSE", "Reverse", True)),
    ),
    "gate_direction": (
        "Gate Direction",
        (("UP", "Up", True), ("DOWN", "Down", True)),
    ),
}
_EQUIPMENT_SET_CODE = "equipment_mode"
_EQUIPMENT_OPTION_COUNT = 320


def _equipment_code(index: int) -> str:
    return f"MODE_{index:03d}"


async def seed_managed_choices(
    session: AsyncSession, *, create_fixed_sets: bool = False
) -> ChoiceSet:
    """Populate fixed options and one reusable, several-hundred-option business set."""

    result = await session.execute(
        select(ChoiceSet).options(selectinload(ChoiceSet.options))
    )
    sets_by_code = {choice_set.code: choice_set for choice_set in result.scalars()}
    missing_fixed = set(_FIXED_SET_DEFINITIONS) - sets_by_code.keys()
    if missing_fixed and not create_fixed_sets:
        missing = ", ".join(sorted(missing_fixed))
        raise RuntimeError(
            "fixed ChoiceSet identities are missing; run alembic upgrade head first: " + missing
        )

    for code, (display_name, option_rows) in _FIXED_SET_DEFINITIONS.items():
        choice_set = sets_by_code.get(code)
        if choice_set is None:
            choice_set = ChoiceSet(code=code, display_name=display_name)
            session.add(choice_set)
            sets_by_code[code] = choice_set
        if not choice_set.options:
            choice_set.options.extend(
                ChoiceOption(
                    code=option_code,
                    label=label,
                    is_active=is_active,
                    sort_order=index * 10,
                )
                for index, (option_code, label, is_active) in enumerate(
                    option_rows, start=1
                )
            )

    equipment_set = sets_by_code.get(_EQUIPMENT_SET_CODE)
    if equipment_set is None:
        equipment_set = ChoiceSet(
            code=_EQUIPMENT_SET_CODE,
            display_name="Equipment Mode",
            description="Shared high-cardinality set for cache, search, and payload evidence",
        )
        session.add(equipment_set)
    if not equipment_set.options:
        equipment_set.options.extend(
            ChoiceOption(
                code=_equipment_code(index),
                label=f"Equipment mode {index:03d}",
                sort_order=index,
                is_active=index < 300,
            )
            for index in range(_EQUIPMENT_OPTION_COUNT)
        )

    await session.flush()
    return equipment_set


async def seed_parameters(
    session: AsyncSession, *, count: int = 200, category_count: int = 5
) -> list[str]:
    """Create ``count`` parameters; all choice parameters reuse ``equipment_mode``."""

    equipment_set = await session.scalar(
        select(ChoiceSet).where(ChoiceSet.code == _EQUIPMENT_SET_CODE)
    )
    if equipment_set is None:
        raise RuntimeError("seed_managed_choices must run before seed_parameters")

    category_count = max(1, min(category_count, len(_CATEGORY_CODES)))
    categories: list[ParameterCategory] = []
    for index in range(category_count):
        code = _CATEGORY_CODES[index]
        category = ParameterCategory(
            code=code, display_name=code.upper(), sort_order=index * 10
        )
        session.add(category)
        categories.append(category)
    await session.flush()

    codes: list[str] = []
    for index in range(count):
        value_type = _VALUE_TYPES[index % len(_VALUE_TYPES)]
        category = categories[index % len(categories)]
        code = f"param_{index:03d}"
        session.add(
            Parameter(
                code=code,
                display_name=f"Parameter {index:03d}",
                description=f"seed parameter {index}",
                value_type=value_type,
                category_id=category.id,
                choice_set=equipment_set if value_type is ValueType.CHOICE else None,
                unit="nm" if value_type is ValueType.NUMBER else None,
                min_value=Decimal("0") if value_type is ValueType.NUMBER else None,
                max_value=Decimal("1000") if value_type is ValueType.NUMBER else None,
                sort_order=index,
            )
        )
        codes.append(code)
    await session.flush()
    return codes


async def seed_project(
    session: AsyncSession,
    *,
    parameter_codes: list[str],
    line_id: str = "L9",
    process_id: str = "PROC_SEED",
    part_id: str = "SEED-PART",
    num_layers: int = 100,
    multi_condition_every: int = 7,
    fill_ratio: float = 1.0,
) -> int:
    """Create one profiled project with a dense, representative sheet."""

    fill_count = max(0, min(len(parameter_codes), int(len(parameter_codes) * fill_ratio)))
    filled_codes = parameter_codes[:fill_count]

    project = Project(
        line_id=line_id,
        process_id=process_id,
        part_id=part_id,
        name="Seed large process-condition sheet",
        status=ProjectStatus.DRAFT,
        profile=ProjectProfile(
            process_name="Seed Process",
            device_type_code="LOGIC",
            project_category_code="DEVELOPMENT",
            comment="Representative Phase 2.6 development seed",
            active_direction_code="FORWARD",
            gate_direction_code="UP",
            gross_die="640",
            pitch_x="0.1",
            pitch_y="0.2",
            shot_x="12.5",
            shot_y="13.5",
            slit_occupancy="0.75",
            lens_occupancy="0.8",
            map_offset_x="0",
            map_offset_y="0",
            scribe_lane_x="0.08",
            scribe_lane_y="0.08",
            shot_count="120",
            full_shot="100",
            layer_total=str(num_layers),
            euv="10",
            imm="20",
            arf="30",
            krf="20",
            iline="10",
            soh="5",
            pspi="5",
            metal_layer_count="18",
        ),
    )

    for layer_index in range(num_layers):
        step_seq = f"{layer_index * 10:04d}"
        layer_id = f"LYR{layer_index % 12:02d}"
        layer = SheetLayer(
            layer_key=f"{line_id}::{process_id}::{step_seq}::{layer_id}",
            step_seq=step_seq,
            layer_id=layer_id,
            eqp_type="SEED",
            eqp_type_desc="seed layer",
            area_name="SEED",
            sort_order=layer_index,
        )
        add_extra = multi_condition_every > 0 and (layer_index + 1) % multi_condition_every == 0
        extra_rows = (1 + (layer_index % 2)) if add_extra else 0
        for condition_index in range(1, 2 + extra_rows):
            condition = LayerCondition(
                label="base" if condition_index == 1 else f"C{condition_index}",
                condition_index=condition_index,
                is_por=condition_index == 1,
            )
            if condition_index == 1:
                condition.cell_values.extend(
                    CellValue(
                        parameter_code=code,
                        value_text=_seed_value(layer_index, position),
                    )
                    for position, code in enumerate(filled_codes)
                )
            layer.conditions.append(condition)
        project.layers.append(layer)

    session.add(project)
    await session.flush()
    return project.id


def _seed_value(layer_index: int, position: int) -> str:
    kind = position % len(_VALUE_TYPES)
    if kind == 0:
        return str((layer_index * 7 + position) % 1000)
    if kind == 2:
        return _equipment_code((layer_index + position) % 300)
    return f"val-{layer_index}-{position}"


async def main() -> None:
    """Seed the Alembic-managed application database."""

    from app.core.db import AppSessionLocal

    async with AppSessionLocal() as session:
        equipment_set = await seed_managed_choices(session)
        codes = await seed_parameters(session, count=200, category_count=5)
        project_id = await seed_project(
            session, parameter_codes=codes, num_layers=100, fill_ratio=1.0
        )
        await session.commit()
        print(
            f"seeded parameters={len(codes)} project_id={project_id} "
            f"shared_choice_set={equipment_set.code} options={len(equipment_set.options)}"
        )


if __name__ == "__main__":
    asyncio.run(main())
