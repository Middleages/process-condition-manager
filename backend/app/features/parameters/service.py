"""Transactional Parameter administration through the managed choice registry."""

from decimal import Decimal

from app.core.errors import ConflictError, NotFoundError
from app.domain.decimal_values import normalize_decimal
from app.domain.parameters import (
    ImportPayload,
    ImportPlan,
    build_import_plan,
    normalize_number_bounds,
    parse_rows,
    validate_code,
    validate_new_parameter,
)
from app.features.choice_sets.repository import ChoiceSetRepository
from app.features.choice_sets.schema import ChoiceSetSummaryOut
from app.features.parameters.repository import ParameterRepository
from app.features.parameters.schema import (
    CategoryCreate,
    CategoryUpdate,
    ParameterCreate,
    ParameterOut,
    ParameterUpdate,
)
from app.models.choice import ChoiceSet
from app.models.parameter import Parameter, ParameterCategory


class ParameterService:
    def __init__(self, repo: ParameterRepository) -> None:
        self.repo = repo
        self.choice_sets = ChoiceSetRepository(repo.session)

    async def create_category(self, data: CategoryCreate) -> ParameterCategory:
        code = validate_code(data.code)
        if await self.repo.get_category_by_code(code) is not None:
            raise ConflictError(f"이미 존재하는 카테고리 code: {code}")
        return await self.repo.add_category(
            ParameterCategory(
                code=code,
                display_name=data.display_name,
                sort_order=data.sort_order,
            )
        )

    async def list_categories(
        self, *, include_inactive: bool = False
    ) -> list[ParameterCategory]:
        return await self.repo.list_categories(include_inactive=include_inactive)

    async def update_category(
        self, category_id: int, data: CategoryUpdate
    ) -> ParameterCategory:
        category = await self.repo.get_category(category_id)
        if category is None:
            raise NotFoundError(f"카테고리를 찾을 수 없다: {category_id}")
        if data.display_name is not None:
            category.display_name = data.display_name
        if data.sort_order is not None:
            category.sort_order = data.sort_order
        if data.is_active is not None:
            category.is_active = data.is_active
        await self.repo.session.flush()
        return category

    async def create_parameter(self, data: ParameterCreate) -> ParameterOut:
        code = validate_new_parameter(
            code=data.code,
            value_type=data.value_type,
            min_value=data.min_value,
            max_value=data.max_value,
            choice_set_code=data.choice_set_code,
        )
        min_value, max_value = normalize_number_bounds(data.min_value, data.max_value)
        if await self.repo.get_parameter_by_code(code) is not None:
            raise ConflictError(f"이미 존재하는 파라미터 code: {code}")
        if data.category_id is not None and await self.repo.get_category(data.category_id) is None:
            raise NotFoundError(f"카테고리를 찾을 수 없다: {data.category_id}")

        locked_sets = await self.choice_sets.lock_active_sets_for_write(
            {data.choice_set_code} if data.choice_set_code is not None else set()
        )
        choice_set = (
            locked_sets[data.choice_set_code]
            if data.choice_set_code is not None
            else None
        )
        parameter = Parameter(
            code=code,
            display_name=data.display_name,
            description=data.description,
            value_type=data.value_type,
            category_id=data.category_id,
            choice_set=choice_set,
            unit=data.unit,
            min_value=_decimal_or_none(min_value),
            max_value=_decimal_or_none(max_value),
            sort_order=data.sort_order,
        )
        await self.repo.add_parameter(parameter)
        return (await self._outputs([parameter]))[0]

    async def get_parameter(self, parameter_id: int) -> ParameterOut:
        parameter = await self._get_parameter_model(parameter_id)
        return (await self._outputs([parameter]))[0]

    async def list_parameters(
        self, *, include_inactive: bool = False
    ) -> list[ParameterOut]:
        parameters = await self.repo.list_parameters(include_inactive=include_inactive)
        return await self._outputs(parameters)

    async def update_parameter(
        self, parameter_id: int, data: ParameterUpdate
    ) -> ParameterOut:
        parameter = await self._get_parameter_model(parameter_id)
        if data.category_id is not None and await self.repo.get_category(data.category_id) is None:
            raise NotFoundError(f"카테고리를 찾을 수 없다: {data.category_id}")

        current_min = _canonical_decimal(parameter.min_value)
        current_max = _canonical_decimal(parameter.max_value)
        next_min = data.min_value if data.min_value is not None else current_min
        next_max = data.max_value if data.max_value is not None else current_max
        canonical_min, canonical_max = normalize_number_bounds(next_min, next_max)

        if data.display_name is not None:
            parameter.display_name = data.display_name
        if data.description is not None:
            parameter.description = data.description
        if data.category_id is not None:
            parameter.category_id = data.category_id
        if data.unit is not None:
            parameter.unit = data.unit
        if data.sort_order is not None:
            parameter.sort_order = data.sort_order
        if data.is_active is not None:
            parameter.is_active = data.is_active
        if data.min_value is not None:
            parameter.min_value = _decimal_or_none(canonical_min)
        if data.max_value is not None:
            parameter.max_value = _decimal_or_none(canonical_max)
        await self.repo.session.flush()
        return (await self._outputs([parameter]))[0]

    async def deactivate_parameter(self, parameter_id: int) -> ParameterOut:
        parameter = await self._get_parameter_model(parameter_id)
        parameter.is_active = False
        await self.repo.session.flush()
        return (await self._outputs([parameter]))[0]

    async def import_preview(self, csv_text: str) -> ImportPlan:
        return build_import_plan(
            parse_rows(csv_text),
            existing_parameters=await self._existing_context(),
            active_choice_set_codes={
                summary.code for summary in await self.choice_sets.list_summaries()
            },
        )

    async def import_apply(self, csv_text: str) -> ImportPlan:
        plan = await self.import_preview(csv_text)
        binding_codes = {
            row.payload.choice_set_code
            for row in plan.rows
            if row.action == "create"
            and row.payload is not None
            and row.payload.choice_set_code is not None
        }
        locked_sets = await self.choice_sets.lock_active_sets_for_write(binding_codes)

        category_cache: dict[str, int] = {}
        for row in plan.rows:
            payload = row.payload
            if payload is None:
                continue
            category_id = await self._resolve_category(payload.category, category_cache)
            if row.action == "create":
                await self.repo.add_parameter(
                    _new_parameter(payload, category_id, locked_sets)
                )
            else:
                await self._apply_update(payload, category_id)
        await self.repo.session.flush()
        return plan

    async def _get_parameter_model(self, parameter_id: int) -> Parameter:
        parameter = await self.repo.get_parameter(parameter_id)
        if parameter is None:
            raise NotFoundError(f"파라미터를 찾을 수 없다: {parameter_id}")
        return parameter

    async def _existing_context(self) -> dict[str, dict[str, str | None]]:
        parameters = await self.repo.list_parameters(include_inactive=True)
        return {
            parameter.code: {
                "value_type": parameter.value_type.value,
                "choice_set_code": (
                    parameter.choice_set.code if parameter.choice_set is not None else None
                ),
            }
            for parameter in parameters
        }

    async def _resolve_category(
        self, code: str | None, cache: dict[str, int]
    ) -> int | None:
        if code is None:
            return None
        if code in cache:
            return cache[code]
        category = await self.repo.get_category_by_code(code)
        if category is None:
            category = await self.repo.add_category(
                ParameterCategory(code=code, display_name=code.upper())
            )
        cache[code] = category.id
        return category.id

    async def _apply_update(
        self, payload: ImportPayload, category_id: int | None
    ) -> None:
        parameter = await self.repo.get_parameter_by_code(payload.code)
        if parameter is None:  # pragma: no cover
            raise NotFoundError(f"파라미터를 찾을 수 없다: {payload.code}")
        parameter.display_name = payload.display_name
        parameter.description = payload.description
        parameter.category_id = category_id
        parameter.unit = payload.unit
        parameter.min_value = _decimal_or_none(payload.min_value)
        parameter.max_value = _decimal_or_none(payload.max_value)
        parameter.sort_order = payload.sort_order

    async def _outputs(self, parameters: list[Parameter]) -> list[ParameterOut]:
        summaries = await self.choice_sets.summaries_by_ids(
            {
                parameter.choice_set_id
                for parameter in parameters
                if parameter.choice_set_id is not None
            }
        )
        return [
            _parameter_out(
                parameter,
                summaries.get(parameter.choice_set_id)
                if parameter.choice_set_id is not None
                else None,
            )
            for parameter in parameters
        ]


def _new_parameter(
    payload: ImportPayload,
    category_id: int | None,
    locked_sets: dict[str, ChoiceSet],
) -> Parameter:
    choice_set = (
        locked_sets[payload.choice_set_code]
        if payload.choice_set_code is not None
        else None
    )
    return Parameter(
        code=payload.code,
        display_name=payload.display_name,
        description=payload.description,
        value_type=payload.value_type,
        category_id=category_id,
        choice_set=choice_set,
        unit=payload.unit,
        min_value=_decimal_or_none(payload.min_value),
        max_value=_decimal_or_none(payload.max_value),
        sort_order=payload.sort_order,
    )


def _parameter_out(
    parameter: Parameter, choice_set: ChoiceSetSummaryOut | None
) -> ParameterOut:
    return ParameterOut(
        id=parameter.id,
        code=parameter.code,
        display_name=parameter.display_name,
        description=parameter.description,
        value_type=parameter.value_type,
        category_id=parameter.category_id,
        unit=parameter.unit,
        min_value=_canonical_decimal(parameter.min_value),
        max_value=_canonical_decimal(parameter.max_value),
        sort_order=parameter.sort_order,
        is_active=parameter.is_active,
        choice_set=choice_set,
    )


def _decimal_or_none(value: str | None) -> Decimal | None:
    return None if value is None else Decimal(value)


def _canonical_decimal(value: Decimal | None) -> str | None:
    return None if value is None else normalize_decimal(format(value, "f"))
