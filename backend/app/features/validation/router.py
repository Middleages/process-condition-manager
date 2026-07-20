"""Authenticated validation-rule administration routes."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import (
    get_current_user,
    require_business_read,
    require_registry_manage,
)
from app.core.db import get_app_session
from app.features.sheets.repository import SheetRepository
from app.features.validation.project_service import ProjectValidationService
from app.features.validation.repository import ValidationRuleRepository
from app.features.validation.rule_service import ValidationRuleService
from app.features.validation.schema import (
    ProjectValidationOut,
    ValidationRuleCreateIn,
    ValidationRuleOut,
    ValidationRulePatchIn,
)

router = APIRouter(
    tags=["validation-rules"],
    dependencies=[Depends(get_current_user)],
)


async def get_service(
    session: Annotated[
        AsyncSession,
        Depends(get_app_session, scope="function"),
    ],
) -> AsyncIterator[ValidationRuleService]:
    service = ValidationRuleService(ValidationRuleRepository(session))
    yield service
    await session.commit()


ServiceDep = Annotated[
    ValidationRuleService,
    Depends(get_service, scope="function"),
]


def get_project_validation_service(
    session: Annotated[AsyncSession, Depends(get_app_session)],
) -> ProjectValidationService:
    return ProjectValidationService(SheetRepository(session))


ProjectServiceDep = Annotated[
    ProjectValidationService,
    Depends(get_project_validation_service),
]


@router.post(
    "/validation-rules",
    response_model=ValidationRuleOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_registry_manage)],
)
async def create_rule(data: ValidationRuleCreateIn, service: ServiceDep) -> ValidationRuleOut:
    return await service.create_rule(data)


@router.get(
    "/validation-rules",
    response_model=list[ValidationRuleOut],
    dependencies=[Depends(require_business_read)],
)
async def list_rules(
    service: ServiceDep, include_inactive: bool = False
) -> list[ValidationRuleOut]:
    return await service.list_rules(include_inactive=include_inactive)


@router.get(
    "/validation-rules/{code}",
    response_model=ValidationRuleOut,
    dependencies=[Depends(require_business_read)],
)
async def get_rule(code: str, service: ServiceDep) -> ValidationRuleOut:
    return await service.get_rule(code)


@router.patch(
    "/validation-rules/{code}",
    response_model=ValidationRuleOut,
    dependencies=[Depends(require_registry_manage)],
)
async def patch_rule(
    code: str, data: ValidationRulePatchIn, service: ServiceDep
) -> ValidationRuleOut:
    return await service.patch_rule(code, data)


@router.post(
    "/projects/{project_id}/validate",
    response_model=ProjectValidationOut,
    tags=["validation"],
    dependencies=[Depends(require_business_read)],
)
async def validate_project(
    project_id: int,
    service: ProjectServiceDep,
) -> ProjectValidationOut:
    return await service.validate_project(project_id)
