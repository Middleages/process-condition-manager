"""조건 행 관리 저장소 (순수 영속화).

도메인 규칙은 모른다. 프로젝트 소속 layer/조건 행 조회, layer 내 조건 행 수 집계,
layer의 POR 조회, 그리고 신규 조건 행/이벤트 추가·삭제만 제공한다. features/ 간
결합을 피하려고 모델을 직접 조회한다 (cells 등 다른 슬라이스를 import하지 않는다 —
조건 행 소속 확인 쿼리도 여기에 따로 둔다).
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import ChangeEvent, LayerCondition, SheetLayer


class ConditionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_layer_in_project(
        self, project_id: int, layer_key: str
    ) -> SheetLayer | None:
        """프로젝트 소속 layer를 조건 행·셀까지 즉시 로딩으로 가져온다 (없으면 None).

        조건 행 전부를 로드하는 이유: 라벨 자동 부여(기존 라벨 집합), condition_index
        최댓값, 복제 원본 소속 확인·셀 복사를 이 한 번의 로드로 처리하기 위함이다.
        복제 원본은 반드시 같은 layer 소속이라, 그 셀 값도 여기서 함께 로드된다.
        """
        stmt = (
            select(SheetLayer)
            .where(SheetLayer.project_id == project_id, SheetLayer.layer_key == layer_key)
            .options(
                selectinload(SheetLayer.conditions).selectinload(LayerCondition.cell_values)
            )
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_condition_in_project(
        self, project_id: int, condition_id: int
    ) -> LayerCondition | None:
        """이 프로젝트 소속 조건 행을 셀·소속 layer까지 로딩해 돌려준다 (아니면 None).

        layer_condition → sheet_layer(project_id) 조인으로 소속을 확인한다. 삭제
        스냅샷(셀 값)과 이벤트 payload(layer_key)를 만들 수 있도록 cell_values와
        layer를 함께 로드한다. 다른 프로젝트/미존재 조건이면 결과가 비어 None이 된다.
        """
        stmt = (
            select(LayerCondition)
            .join(SheetLayer, LayerCondition.layer_id == SheetLayer.id)
            .where(SheetLayer.project_id == project_id, LayerCondition.id == condition_id)
            .options(
                selectinload(LayerCondition.cell_values),
                selectinload(LayerCondition.layer),
            )
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def count_conditions_in_layer(self, layer_id: int) -> int:
        """layer 안의 조건 행 수 (layer당 최소 1행 유지 판정용)."""
        stmt = select(func.count(LayerCondition.id)).where(
            LayerCondition.layer_id == layer_id
        )
        return int((await self.session.execute(stmt)).scalar_one())

    async def find_por_condition(self, layer_id: int) -> LayerCondition | None:
        """layer의 현재 POR 조건 행 (없으면 None).

        partial unique index가 layer당 POR 1개를 강제하므로 결과는 0 또는 1건이다.
        세션 식별 맵 덕분에, 대상 조건 행 자체가 POR이면 이미 로드된 그 객체가
        그대로 돌아온다 (POR 이양 시 no-op 판정에 활용).
        """
        stmt = select(LayerCondition).where(
            LayerCondition.layer_id == layer_id,
            LayerCondition.is_por.is_(True),
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    def add_condition(self, condition: LayerCondition) -> None:
        self.session.add(condition)

    def add_event(self, event: ChangeEvent) -> None:
        self.session.add(event)

    async def delete_condition(self, condition: LayerCondition) -> None:
        await self.session.delete(condition)

    async def flush(self) -> None:
        await self.session.flush()
