from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.choices.constants import PROFILE_CHOICE_SET_FIELDS
from app.domain.parameters.types import ValueType
from app.models.choice import ChoiceOption, ChoiceSet
from app.models.parameter import Parameter, ParameterCategory
from app.models.project import ProjectProfile


def make_project_profile(
    *,
    process_name: str = "Test process",
    device_type_code: str = "DEFAULT",
    project_category_code: str = "DEFAULT",
) -> ProjectProfile:
    return ProjectProfile(
        process_name=process_name,
        device_type_code=device_type_code,
        project_category_code=project_category_code,
    )


async def seed_choice_set(
    session: AsyncSession,
    *,
    code: str,
    options: tuple[tuple[str, str, bool], ...] = (),
    is_active: bool = True,
) -> ChoiceSet:
    choice_set = ChoiceSet(code=code, display_name=code, is_active=is_active)
    choice_set.options.extend(
        ChoiceOption(code=value, label=label, is_active=active, sort_order=index * 10)
        for index, (value, label, active) in enumerate(options, start=1)
    )
    session.add(choice_set)
    await session.flush()
    return choice_set


async def seed_required_profile_choice_sets(session: AsyncSession) -> dict[str, ChoiceSet]:
    result: dict[str, ChoiceSet] = {}
    for code in PROFILE_CHOICE_SET_FIELDS:
        result[code] = await seed_choice_set(
            session,
            code=code,
            options=(("DEFAULT", f"{code} default", True),),
        )
    return result


async def seed_parameter(
    session: AsyncSession,
    *,
    code: str,
    value_type: ValueType,
    choice_set: ChoiceSet | None = None,
) -> Parameter:
    category = ParameterCategory(code=f"cat_{code}", display_name=code)
    parameter = Parameter(
        code=code,
        display_name=code,
        value_type=value_type,
        category=category,
        choice_set=choice_set,
        min_value=Decimal("0") if value_type is ValueType.NUMBER else None,
        max_value=Decimal("1000") if value_type is ValueType.NUMBER else None,
    )
    session.add(parameter)
    await session.flush()
    return parameter
