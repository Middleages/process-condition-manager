"""셀 편집 저장 라우터.

라우터는 얇게 유지한다 — 세션→repo→service 배선과 응답 위임만 한다. 쓰기
경계이므로 projects/locks 라우터와 같은 방식으로 yield 후 commit 한다.
이 슬라이스의 유일한 엔드포인트가 편집 API이므로 잠금 검사(require_edit_lock)를
라우터 레벨에 걸어 모든 요청이 유효 잠금 보유자만 통과하도록 한다.
"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import UserContext, get_current_user
from app.core.db import get_app_session
from app.core.locks import require_edit_lock
from app.core.maintenance import require_project_mutations_enabled
from app.features.cells.repository import CellRepository
from app.features.cells.schema import CellsPatchIn, CellsPatchOut
from app.features.cells.service import CellService

router = APIRouter(
    prefix="/projects",
    tags=["cells"],
    dependencies=[
        Depends(get_current_user),
        Depends(require_project_mutations_enabled),
        Depends(require_edit_lock),
    ],
)


async def get_service(
    session: Annotated[AsyncSession, Depends(get_app_session, scope="function")],
) -> AsyncIterator[CellService]:
    service = CellService(CellRepository(session))
    yield service
    await session.commit()


ServiceDep = Annotated[CellService, Depends(get_service, scope="function")]
UserDep = Annotated[UserContext, Depends(get_current_user)]


@router.patch("/{project_id}/cells", response_model=CellsPatchOut)
async def patch_cells(
    project_id: int, data: CellsPatchIn, service: ServiceDep, user: UserDep
) -> CellsPatchOut:
    return await service.patch_cells(project_id, data, actor=user.id)
