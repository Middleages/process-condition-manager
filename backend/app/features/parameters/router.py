"""파라미터 레지스트리 관리자 CRUD 라우터.

모든 엔드포인트는 처음부터 get_current_user 의존성을 통과한다 (인증 경계 P4).
실제 인가 규칙(RBAC)은 T5/Phase 5에서 이 배선 뒤에 추가된다.
"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.db import get_app_session
from app.domain.parameters import ImportPlan
from app.features.parameters.repository import ParameterRepository
from app.features.parameters.schema import (
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    ImportIn,
    ImportResultOut,
    ImportRowOut,
    OptionIn,
    ParameterCreate,
    ParameterOut,
    ParameterUpdate,
)
from app.features.parameters.service import ParameterService

router = APIRouter(
    prefix="/parameters",
    tags=["parameters"],
    dependencies=[Depends(get_current_user)],
)


async def get_service(
    session: Annotated[AsyncSession, Depends(get_app_session)],
) -> AsyncIterator[ParameterService]:
    """요청 스코프 서비스 + 트랜잭션 커밋 경계."""
    service = ParameterService(ParameterRepository(session))
    yield service
    await session.commit()


ServiceDep = Annotated[ParameterService, Depends(get_service)]


# --- Categories ---


@router.post(
    "/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED
)
async def create_category(data: CategoryCreate, service: ServiceDep) -> CategoryOut:
    category = await service.create_category(data)
    return CategoryOut.model_validate(category)


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(
    service: ServiceDep, include_inactive: bool = False
) -> list[CategoryOut]:
    categories = await service.list_categories(include_inactive=include_inactive)
    return [CategoryOut.model_validate(c) for c in categories]


@router.patch("/categories/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: int, data: CategoryUpdate, service: ServiceDep
) -> CategoryOut:
    category = await service.update_category(category_id, data)
    return CategoryOut.model_validate(category)


# --- CSV 임포트 (T8) ---


def _import_result(plan: ImportPlan) -> ImportResultOut:
    return ImportResultOut(
        created_count=plan.created_count,
        updated_count=plan.updated_count,
        error_count=plan.error_count,
        rows=[
            ImportRowOut(line=row.line, code=row.code, action=row.action, message=row.message)
            for row in plan.rows
        ],
    )


@router.post("/import/preview", response_model=ImportResultOut)
async def import_preview(data: ImportIn, service: ServiceDep) -> ImportResultOut:
    return _import_result(await service.import_preview(data.csv_text))


@router.post("/import/apply", response_model=ImportResultOut)
async def import_apply(data: ImportIn, service: ServiceDep) -> ImportResultOut:
    return _import_result(await service.import_apply(data.csv_text))


# --- Parameters ---


@router.post("", response_model=ParameterOut, status_code=status.HTTP_201_CREATED)
async def create_parameter(data: ParameterCreate, service: ServiceDep) -> ParameterOut:
    parameter = await service.create_parameter(data)
    return ParameterOut.model_validate(parameter)


@router.get("", response_model=list[ParameterOut])
async def list_parameters(
    service: ServiceDep, include_inactive: bool = False
) -> list[ParameterOut]:
    parameters = await service.list_parameters(include_inactive=include_inactive)
    return [ParameterOut.model_validate(p) for p in parameters]


@router.get("/{parameter_id}", response_model=ParameterOut)
async def get_parameter(parameter_id: int, service: ServiceDep) -> ParameterOut:
    parameter = await service.get_parameter(parameter_id)
    return ParameterOut.model_validate(parameter)


@router.patch("/{parameter_id}", response_model=ParameterOut)
async def update_parameter(
    parameter_id: int, data: ParameterUpdate, service: ServiceDep
) -> ParameterOut:
    parameter = await service.update_parameter(parameter_id, data)
    return ParameterOut.model_validate(parameter)


@router.post("/{parameter_id}/deactivate", response_model=ParameterOut)
async def deactivate_parameter(parameter_id: int, service: ServiceDep) -> ParameterOut:
    parameter = await service.deactivate_parameter(parameter_id)
    return ParameterOut.model_validate(parameter)


@router.put("/{parameter_id}/options", response_model=ParameterOut)
async def replace_options(
    parameter_id: int, options: list[OptionIn], service: ServiceDep
) -> ParameterOut:
    parameter = await service.replace_options(parameter_id, options)
    return ParameterOut.model_validate(parameter)
