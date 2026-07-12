"""조건 행 관리 라우터 (추가/복제·삭제·POR 이양).

라우터는 얇게 유지한다 — 세션→repo→service 배선과 응답 위임만 한다. 쓰기 경계
이므로 projects/cells 라우터와 같은 방식으로 yield 후 commit 한다. 세 엔드포인트
모두 편집 API이고 경로에 project_id를 가지므로, 잠금 검사(require_edit_lock)를
라우터 레벨에 걸어 유효 잠금 보유자만 통과하도록 한다.
"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import UserContext, get_current_user
from app.core.db import get_app_session
from app.core.locks import require_edit_lock
from app.features.conditions.repository import ConditionRepository
from app.features.conditions.schema import ConditionCreateIn, ConditionOut
from app.features.conditions.service import ConditionService

router = APIRouter(
    prefix="/projects",
    tags=["conditions"],
    dependencies=[Depends(get_current_user), Depends(require_edit_lock)],
)


async def get_service(
    session: Annotated[AsyncSession, Depends(get_app_session)],
) -> AsyncIterator[ConditionService]:
    service = ConditionService(ConditionRepository(session))
    yield service
    await session.commit()


ServiceDep = Annotated[ConditionService, Depends(get_service)]
UserDep = Annotated[UserContext, Depends(get_current_user)]


@router.post(
    "/{project_id}/layers/{layer_key}/conditions",
    response_model=ConditionOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_condition(
    project_id: int,
    layer_key: str,
    data: ConditionCreateIn,
    service: ServiceDep,
    user: UserDep,
) -> ConditionOut:
    return await service.add_condition(project_id, layer_key, data, actor=user.id)


@router.delete(
    "/{project_id}/conditions/{condition_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_condition(
    project_id: int, condition_id: int, service: ServiceDep, user: UserDep
) -> None:
    await service.delete_condition(project_id, condition_id, actor=user.id)


@router.put("/{project_id}/conditions/{condition_id}/por", response_model=ConditionOut)
async def set_por(
    project_id: int, condition_id: int, service: ServiceDep, user: UserDep
) -> ConditionOut:
    return await service.set_por(project_id, condition_id, actor=user.id)
