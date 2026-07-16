"""셀 편집 저장소 (순수 영속화).

도메인 규칙은 모른다. 프로젝트 존재 확인, 조건 행 소속 확인, 대상 셀 값 조회,
그리고 신규 행/이벤트 추가만 제공한다. features/ 간 결합을 피하려고 모델을 직접
조회한다 (다른 슬라이스를 import하지 않는다).
"""

from collections.abc import Collection

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.parameter import Parameter
from app.models.project import CellValue, ChangeEvent, LayerCondition, Project, SheetLayer


class CellRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def project_exists(self, project_id: int) -> bool:
        """저장 대상 프로젝트 실재 여부 (깔끔한 404를 내기 위함)."""
        result = await self.session.execute(
            select(Project.id).where(Project.id == project_id)
        )
        return result.scalar_one_or_none() is not None

    async def condition_ids_in_project(
        self, project_id: int, condition_ids: Collection[int]
    ) -> set[int]:
        """요청 condition_id 중 이 프로젝트 소속인 것만 골라 돌려준다.

        layer_condition → sheet_layer(project_id) 조인으로 소속을 확인한다.
        반환 집합이 요청 집합과 다르면 타 프로젝트/미존재 조건이 섞인 것이다.
        """
        if not condition_ids:
            return set()
        stmt = (
            select(LayerCondition.id)
            .join(SheetLayer, LayerCondition.layer_id == SheetLayer.id)
            .where(
                SheetLayer.project_id == project_id,
                LayerCondition.id.in_(condition_ids),
            )
        )
        return set((await self.session.execute(stmt)).scalars().all())

    async def load_cell_values(self, condition_ids: Collection[int]) -> list[CellValue]:
        """대상 조건 행들의 기존 셀 값을 한 번에 로드한다 (old_value 판정용)."""
        if not condition_ids:
            return []
        stmt = select(CellValue).where(CellValue.condition_id.in_(condition_ids))
        return list((await self.session.execute(stmt)).scalars().all())

    async def condition_layer_keys(self, condition_ids: Collection[int]) -> dict[int, str]:
        """조건 행 id를 layer_key로 인덱싱해 돌려준다."""
        if not condition_ids:
            return {}
        stmt = (
            select(LayerCondition.id, SheetLayer.layer_key)
            .join(SheetLayer, LayerCondition.layer_id == SheetLayer.id)
            .where(LayerCondition.id.in_(condition_ids))
        )
        rows = await self.session.execute(stmt)
        return {condition_id: layer_key for condition_id, layer_key in rows.all()}

    async def active_parameters_by_code(
        self, codes: Collection[str]
    ) -> dict[str, Parameter]:
        """요청에 등장한 code 중 활성 Parameter를 code로 인덱싱해 돌려준다.

        저장 시 타입 정합성 최종 검증(value_type/ChoiceSet)의 데이터 공급 경로다.
        choice set은 Parameter.choice_set(lazy="selectin")으로 함께 로드된다. 전체
        파라미터가 많아야 ~200개라 요청에 등장한 code만(Parameter.code.in_) 좁혀
        가져온다. cell/event가 code로만 파라미터를 참조하므로(FK 아님) 미존재·비활성
        code는 결과에서 빠진다 — 호출측이 "레지스트리에 없으면 검증 생략"으로 본다.
        """
        if not codes:
            return {}
        stmt = select(Parameter).where(
            Parameter.is_active.is_(True),
            Parameter.code.in_(codes),
        )
        rows = (await self.session.execute(stmt)).scalars().all()
        return {param.code: param for param in rows}

    def add_cell_value(self, cell: CellValue) -> None:
        self.session.add(cell)

    def add_event(self, event: ChangeEvent) -> None:
        self.session.add(event)

    async def flush(self) -> None:
        await self.session.flush()
