"""파라미터 레지스트리 저장소 계층 (DB 접근 전담).

도메인 규칙은 알지 못한다. 순수 CRUD 쿼리만 제공한다.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.parameter import Parameter, ParameterCategory


class ParameterRepository:
    """파라미터/카테고리/선택지 저장소."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- Category ---

    async def add_category(self, category: ParameterCategory) -> ParameterCategory:
        self.session.add(category)
        await self.session.flush()
        return category

    async def get_category(self, category_id: int) -> ParameterCategory | None:
        return await self.session.get(ParameterCategory, category_id)

    async def get_category_by_code(self, code: str) -> ParameterCategory | None:
        stmt = select(ParameterCategory).where(ParameterCategory.code == code)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_categories(
        self, *, include_inactive: bool = False
    ) -> list[ParameterCategory]:
        stmt = select(ParameterCategory).order_by(
            ParameterCategory.sort_order, ParameterCategory.code
        )
        if not include_inactive:
            stmt = stmt.where(ParameterCategory.is_active.is_(True))
        return list((await self.session.execute(stmt)).scalars().all())

    # --- Parameter ---

    async def add_parameter(self, parameter: Parameter) -> Parameter:
        self.session.add(parameter)
        await self.session.flush()
        return parameter

    async def get_parameter(self, parameter_id: int) -> Parameter | None:
        return await self.session.get(Parameter, parameter_id)

    async def get_parameter_for_update(self, parameter_id: int) -> Parameter | None:
        stmt = (
            select(Parameter)
            .where(Parameter.id == parameter_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_parameter_by_code(self, code: str) -> Parameter | None:
        stmt = select(Parameter).where(Parameter.code == code)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_parameters(
        self, *, include_inactive: bool = False
    ) -> list[Parameter]:
        stmt = select(Parameter).order_by(Parameter.sort_order, Parameter.code)
        if not include_inactive:
            stmt = stmt.where(Parameter.is_active.is_(True))
        return list((await self.session.execute(stmt)).scalars().all())
