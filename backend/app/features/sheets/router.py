"""시트 조회 라우터.

라우터는 얇게 유지한다 — 의존성 배선과 응답 위임만 한다. 조회 전용이므로
commit 경계는 두지 않는다. 인증 경계(get_current_user)는 처음부터 통과한다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import UserContext, get_current_user, require_business_read
from app.core.db import get_app_session
from app.features.sheets.repository import SheetRepository
from app.features.sheets.schema import SheetOut
from app.features.sheets.service import SheetService

router = APIRouter(
    prefix="/projects",
    tags=["sheets"],
    dependencies=[Depends(get_current_user)],
)


def get_service(
    session: Annotated[AsyncSession, Depends(get_app_session)],
) -> SheetService:
    return SheetService(SheetRepository(session))


ServiceDep = Annotated[SheetService, Depends(get_service)]
UserDep = Annotated[UserContext, Depends(get_current_user)]


@router.get(
    "/{project_id}/sheet",
    response_model=SheetOut,
    dependencies=[Depends(require_business_read)],
)
async def get_sheet(project_id: int, service: ServiceDep, user: UserDep) -> SheetOut:
    return await service.get_sheet(project_id, user_id=user.id)
