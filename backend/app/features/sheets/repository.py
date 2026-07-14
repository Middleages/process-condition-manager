"""시트 조회 저장소 (순수 쿼리 전담).

도메인 규칙은 모른다. 프로젝트 트리(layers → conditions → cell_values)와
live 파라미터/카테고리 조회만 제공한다. features/ 간 결합을 피하려고 모델을
직접 조회한다 (parameters 슬라이스를 import하지 않는다).
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.parameter import Parameter, ParameterCategory
from app.models.project import EditLock, LayerCondition, Project, SheetLayer


class SheetRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def load_project_tree(self, project_id: int) -> Project | None:
        """프로젝트 하나를 조건 행·셀까지 즉시 로딩으로 가져온다.

        layer는 sort_order, 조건 행은 condition_index 순서(모델 relationship
        order_by)로 로드된다 — service는 정렬을 다시 하지 않아도 된다.
        """
        result = await self.session.execute(
            select(Project)
            .where(Project.id == project_id)
            .options(
                selectinload(Project.layers)
                .selectinload(SheetLayer.conditions)
                .selectinload(LayerCondition.cell_values)
            )
        )
        return result.scalar_one_or_none()

    async def list_active_parameters(self) -> list[Parameter]:
        """활성 파라미터를 컬럼 순서(sort_order, code)로 조회한다.

        choice 파라미터의 ChoiceSet은 relationship(lazy="selectin")으로 함께 로드된다.
        """
        stmt = (
            select(Parameter)
            .where(Parameter.is_active.is_(True))
            .order_by(Parameter.sort_order, Parameter.code)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_active_categories(self) -> list[ParameterCategory]:
        """활성 카테고리 — 파라미터의 category_id를 category_code로 옮길 때 쓴다."""
        stmt = select(ParameterCategory).where(ParameterCategory.is_active.is_(True))
        return list((await self.session.execute(stmt)).scalars().all())

    async def load_edit_lock(self, project_id: int) -> EditLock | None:
        """프로젝트 편집 잠금 행을 직접 조회한다.

        잠금 요약("누가 편집 중")의 데이터 공급 경로다. features/ 간 결합을 피하려고
        locks 슬라이스를 import하지 않고 edit_lock 모델을 직접(PK) 조회한다.
        """
        return await self.session.get(EditLock, project_id)
