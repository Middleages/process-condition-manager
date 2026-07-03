"""파라미터 레지스트리 서비스 계층.

도메인 규칙(순수)과 저장소(DB)를 조율한다. 도메인 규칙 위반은 DomainError로
그대로 전파(→422)하고, HTTP 성격의 조건(중복 code=409, 미존재=404)은
core.errors 예외로 변환한다.
"""

from app.core.errors import ConflictError, NotFoundError
from app.domain.parameters import validate_code, validate_new_parameter
from app.domain.parameters.rules import (
    validate_choice_options,
    validate_number_bounds,
)
from app.features.parameters.repository import ParameterRepository
from app.features.parameters.schema import (
    CategoryCreate,
    CategoryUpdate,
    OptionIn,
    ParameterCreate,
    ParameterUpdate,
)
from app.models.parameter import Parameter, ParameterCategory, ParameterOption


class ParameterService:
    """관리자 파라미터 레지스트리 오케스트레이션."""

    def __init__(self, repo: ParameterRepository) -> None:
        self.repo = repo

    # --- Category ---

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

    # --- Parameter ---

    async def create_parameter(self, data: ParameterCreate) -> Parameter:
        option_values = [o.value for o in data.options]
        code = validate_new_parameter(
            code=data.code,
            value_type=data.value_type,
            min_value=data.min_value,
            max_value=data.max_value,
            option_values=option_values,
        )
        if await self.repo.get_parameter_by_code(code) is not None:
            raise ConflictError(f"이미 존재하는 파라미터 code: {code}")
        if data.category_id is not None:
            if await self.repo.get_category(data.category_id) is None:
                raise NotFoundError(f"카테고리를 찾을 수 없다: {data.category_id}")

        parameter = Parameter(
            code=code,
            display_name=data.display_name,
            description=data.description,
            value_type=data.value_type,
            category_id=data.category_id,
            unit=data.unit,
            min_value=data.min_value,
            max_value=data.max_value,
            sort_order=data.sort_order,
            options=[_to_option(o) for o in data.options],
        )
        return await self.repo.add_parameter(parameter)

    async def get_parameter(self, parameter_id: int) -> Parameter:
        parameter = await self.repo.get_parameter(parameter_id)
        if parameter is None:
            raise NotFoundError(f"파라미터를 찾을 수 없다: {parameter_id}")
        return parameter

    async def list_parameters(
        self, *, include_inactive: bool = False
    ) -> list[Parameter]:
        return await self.repo.list_parameters(include_inactive=include_inactive)

    async def update_parameter(
        self, parameter_id: int, data: ParameterUpdate
    ) -> Parameter:
        parameter = await self.get_parameter(parameter_id)
        if data.display_name is not None:
            parameter.display_name = data.display_name
        if data.description is not None:
            parameter.description = data.description
        if data.category_id is not None:
            if await self.repo.get_category(data.category_id) is None:
                raise NotFoundError(f"카테고리를 찾을 수 없다: {data.category_id}")
            parameter.category_id = data.category_id
        if data.unit is not None:
            parameter.unit = data.unit
        if data.sort_order is not None:
            parameter.sort_order = data.sort_order
        if data.is_active is not None:
            parameter.is_active = data.is_active
        if data.min_value is not None:
            parameter.min_value = data.min_value
        if data.max_value is not None:
            parameter.max_value = data.max_value
        # 변경 후 유효 경계 재검증
        validate_number_bounds(parameter.min_value, parameter.max_value)
        await self.repo.session.flush()
        return parameter

    async def deactivate_parameter(self, parameter_id: int) -> Parameter:
        """하드 삭제 금지 — 소프트 삭제(is_active=false)만 수행한다."""
        parameter = await self.get_parameter(parameter_id)
        parameter.is_active = False
        await self.repo.session.flush()
        return parameter

    async def replace_options(
        self, parameter_id: int, options: list[OptionIn]
    ) -> Parameter:
        parameter = await self.get_parameter(parameter_id)
        validate_choice_options(parameter.value_type, [o.value for o in options])
        await self.repo.replace_options(
            parameter, [_to_option(o) for o in options]
        )
        return parameter


def _to_option(data: OptionIn) -> ParameterOption:
    return ParameterOption(
        value=data.value,
        display_name=data.display_name,
        sort_order=data.sort_order,
    )
