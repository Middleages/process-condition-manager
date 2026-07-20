"""편집 잠금 라우터 (획득/하트비트/해제).

라우터는 얇게 유지한다 — 세션→repo→service 배선과 응답 위임만 한다.
쓰기 경계이므로 projects 라우터와 같은 방식으로 yield 후 commit 한다.
잠금 검사(require_edit_lock)는 core 공용 의존성이며 편집 계열 API가 가져다 쓴다;
이 라우터의 3개 엔드포인트는 잠금 자체를 관리하므로 검사 의존성을 걸지 않는다.
"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import (
    UserContext,
    get_current_user,
    require_project_edit,
)
from app.core.db import get_app_session
from app.core.locks import as_utc, require_project_read_only
from app.core.maintenance import require_project_mutations_enabled
from app.features.locks.repository import EditLockRepository
from app.features.locks.schema import LockHeartbeatIn, LockOut, LockReleaseIn
from app.features.locks.service import LockService
from app.models.project import EditLock

router = APIRouter(
    prefix="/projects",
    tags=["locks"],
    dependencies=[Depends(get_current_user)],
)


async def get_service(
    session: Annotated[AsyncSession, Depends(get_app_session, scope="function")],
) -> AsyncIterator[LockService]:
    service = LockService(EditLockRepository(session))
    yield service
    await session.commit()


ServiceDep = Annotated[LockService, Depends(get_service, scope="function")]
UserDep = Annotated[UserContext, Depends(get_current_user)]


@router.post(
    "/{project_id}/lock",
    response_model=LockOut,
    dependencies=[
        Depends(require_project_mutations_enabled),
        Depends(require_project_edit),
        Depends(require_project_read_only),
    ],
)
async def acquire_lock(project_id: int, service: ServiceDep, user: UserDep) -> LockOut:
    lock = await service.acquire(project_id, user_id=user.id)
    return _lock_out(lock)


@router.post(
    "/{project_id}/lock/heartbeat",
    response_model=LockOut,
    dependencies=[
        Depends(require_project_mutations_enabled),
        Depends(require_project_edit),
        Depends(require_project_read_only),
    ],
)
async def heartbeat_lock(
    project_id: int, data: LockHeartbeatIn, service: ServiceDep, user: UserDep
) -> LockOut:
    lock = await service.heartbeat(project_id, user_id=user.id, lock_token=data.lock_token)
    return _lock_out(lock)


@router.delete(
    "/{project_id}/lock",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_project_edit)],
)
async def release_lock(
    project_id: int, data: LockReleaseIn, service: ServiceDep, user: UserDep
) -> None:
    await service.release(project_id, user_id=user.id, lock_token=data.lock_token)


@router.post(
    "/{project_id}/lock/release",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_project_edit)],
)
async def release_lock_beacon(
    project_id: int, data: LockReleaseIn, service: ServiceDep, user: UserDep
) -> None:
    """탭 종료 sendBeacon용 POST 해제 경로.

    sendBeacon은 메서드를 DELETE로 바꿀 수 없으므로 전송 보장이 필요한 unload 경로만
    POST 별칭을 쓴다. 토큰/보유자 판정은 일반 DELETE와 동일한 service.release가 담당한다.
    """
    await service.release(project_id, user_id=user.id, lock_token=data.lock_token)


def _lock_out(lock: EditLock) -> LockOut:
    # 응답 datetime을 aware UTC로 통일한다 (SQLite naive/PG aware 차이 흡수).
    return LockOut(
        locked_by=lock.locked_by,
        lock_token=lock.lock_token,
        locked_at=as_utc(lock.locked_at),
        expires_at=as_utc(lock.expires_at),
    )
