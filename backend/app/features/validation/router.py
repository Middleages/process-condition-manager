"""Authenticated validation-rule administration routes."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.db import get_app_session
from app.features.validation.repository import ValidationRuleRepository
from app.features.validation.rule_service import ValidationRuleService
from app.features.validation.schema import (
    ValidationRuleCreateIn,
    ValidationRuleOut,
    ValidationRulePatchIn,
)

router = APIRouter(
    prefix="/validation-rules",
    tags=["validation-rules"],
    dependencies=[Depends(get_current_user)],
)


async def get_service(
    session: Annotated[AsyncSession, Depends(get_app_session, scope="function")],
) -> AsyncIterator[ValidationRuleService]:
    service = ValidationRuleService(ValidationRuleRepository(session))
    yield service
    await session.commit()


ServiceDep = Annotated[ValidationRuleService, Depends(get_service, scope="function")]


@router.post(
    "",
    response_model=ValidationRuleOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_rule(data: ValidationRuleCreateIn, service: ServiceDep) -> ValidationRuleOut:
    return await service.create_rule(data)


@router.get(
    "",
    response_model=list[ValidationRuleOut],
)
async def list_rules(
    service: ServiceDep, include_inactive: bool = False
) -> list[ValidationRuleOut]:
    return await service.list_rules(include_inactive=include_inactive)


@router.get(
    "/{code}",
    response_model=ValidationRuleOut,
)
async def get_rule(code: str, service: ServiceDep) -> ValidationRuleOut:
    return await service.get_rule(code)


@router.patch(
    "/{code}",
    response_model=ValidationRuleOut,
)
async def patch_rule(
    code: str, data: ValidationRulePatchIn, service: ServiceDep
) -> ValidationRuleOut:
    return await service.patch_rule(code, data)
