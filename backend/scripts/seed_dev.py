"""개발용 시드 스크립트.

대형 시트(EC2·성능 측정·T2 데모의 공용 재료)를 만든다:

- 파라미터 약 200개 — 카테고리 4~6개에 고르게 분배, value_type을 number/text/choice
  로 섞는다 (choice는 선택지 몇 개 부여). CSV 임포트 로직(app.domain.parameters)의
  검증 규칙을 참고했으나, 시드는 단순 반복 생성으로 충분하다.
- process 하나를 60~100 layer 규모로 만든다 — fixture 데이터(2~3 layer)로는 부족하므로
  SheetLayer/LayerCondition/CellValue를 직접 다건 생성한다.
- 일부 layer에는 다중 조건 행(2~3개)을 부여해 그룹핑 렌더링 확인 재료로 삼는다.

seed 함수들은 임의의 AsyncSession에서 동작하므로 성능 측정 스크립트가 재사용한다.

실행: `cd backend && uv run python -m scripts.seed_dev`
(APP_DATABASE_URL 이 가리키는 앱 DB에 시드한다 — 스키마는 Alembic upgrade 선행 필요.)
"""

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.parameters.types import ValueType
from app.models.parameter import Parameter, ParameterCategory, ParameterOption
from app.models.project import (
    CellValue,
    LayerCondition,
    Project,
    ProjectStatus,
    SheetLayer,
)

_CATEGORY_CODES = ("photo", "etch", "clean", "depo", "cmp", "metro")
_VALUE_TYPES = (ValueType.NUMBER, ValueType.TEXT, ValueType.CHOICE)
_CHOICE_VALUES = ("low", "mid", "high", "auto")


async def seed_parameters(
    session: AsyncSession, *, count: int = 200, category_count: int = 5
) -> list[str]:
    """활성 파라미터 count개를 생성하고 code 목록을 반환한다.

    카테고리는 category_count개(기본 5), value_type은 number/text/choice를 순환한다.
    """
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
        parameter = Parameter(
            code=code,
            display_name=f"Parameter {index:03d}",
            description=f"seed parameter {index}",
            value_type=value_type,
            category_id=category.id,
            unit="nm" if value_type == ValueType.NUMBER else None,
            min_value=0.0 if value_type == ValueType.NUMBER else None,
            max_value=1000.0 if value_type == ValueType.NUMBER else None,
            sort_order=index,
        )
        if value_type == ValueType.CHOICE:
            parameter.options.extend(
                ParameterOption(
                    value=value, display_name=value.upper(), sort_order=order
                )
                for order, value in enumerate(_CHOICE_VALUES)
            )
        session.add(parameter)
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
    num_layers: int = 80,
    multi_condition_every: int = 7,
    fill_ratio: float = 1.0,
) -> int:
    """num_layers개 layer를 가진 프로젝트를 만들고 project.id를 반환한다.

    - 각 layer의 첫 조건 행(base)에는 parameter_codes의 앞 fill_ratio 비율만큼 셀을 채운다.
    - multi_condition_every 간격의 layer에는 조건 행을 2~3개 부여한다.
    """
    fill_count = max(0, min(len(parameter_codes), int(len(parameter_codes) * fill_ratio)))
    filled_codes = parameter_codes[:fill_count]

    project = Project(
        line_id=line_id,
        process_id=process_id,
        part_id=part_id,
        name="Seed 대형 조건표",
        description=f"{num_layers} layer x {len(parameter_codes)} parameter 시드",
        status=ProjectStatus.DRAFT,
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
        # 다중 조건 행: 기본 1행 + 주기적으로 1~2행 추가 (그룹핑 렌더 재료).
        extra_rows = ((layer_index % multi_condition_every) == 0) * (
            1 + (layer_index % 2)
        )
        condition_count = 1 + extra_rows
        for condition_index in range(1, condition_count + 1):
            condition = LayerCondition(
                label="base" if condition_index == 1 else f"C{condition_index}",
                condition_index=condition_index,
                is_por=(condition_index == 1),
            )
            # 첫(base) 행에만 셀을 채운다 — 약 2만 셀 규모의 밀도 기준.
            if condition_index == 1:
                condition.cell_values.extend(
                    CellValue(
                        parameter_code=code,
                        value_text=_seed_value(code, layer_index, position),
                    )
                    for position, code in enumerate(filled_codes)
                )
            layer.conditions.append(condition)
        project.layers.append(layer)

    session.add(project)
    await session.flush()
    return project.id


def _seed_value(code: str, layer_index: int, position: int) -> str:
    """파라미터 code 순환 위치에 맞춰 그럴듯한 값을 만든다."""
    kind = position % len(_VALUE_TYPES)
    if kind == 0:  # number
        return str((layer_index * 7 + position) % 1000)
    if kind == 2:  # choice
        return _CHOICE_VALUES[(layer_index + position) % len(_CHOICE_VALUES)]
    return f"val-{layer_index}-{position}"


async def main() -> None:
    """앱 DB에 대형 시트 하나를 시드한다."""
    from app.core.db import AppSessionLocal

    async with AppSessionLocal() as session:
        codes = await seed_parameters(session, count=200, category_count=5)
        project_id = await seed_project(
            session, parameter_codes=codes, num_layers=80, fill_ratio=1.0
        )
        await session.commit()
        print(f"seeded parameters={len(codes)} project_id={project_id}")


if __name__ == "__main__":
    asyncio.run(main())
