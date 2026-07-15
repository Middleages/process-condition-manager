"""Authenticated ChoiceSet administration routes."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.db import get_app_session
from app.features.choice_sets.repository import ChoiceSetRepository
from app.features.choice_sets.schema import (
    ChoiceImportApplyOut,
    ChoiceImportIn,
    ChoiceImportPreviewOut,
    ChoiceOptionCreateIn,
    ChoiceOptionMutationOut,
    ChoiceOptionOrderIn,
    ChoiceOptionPageOut,
    ChoiceOptionPatchIn,
    ChoiceSetCreateIn,
    ChoiceSetPatchIn,
    ChoiceSetSummaryOut,
)
from app.features.choice_sets.service import ChoiceSetService

router = APIRouter(
    prefix="/choice-sets",
    tags=["choice-sets"],
    dependencies=[Depends(get_current_user)],
)


async def get_service(
    session: Annotated[AsyncSession, Depends(get_app_session, scope="function")],
) -> AsyncIterator[ChoiceSetService]:
    service = ChoiceSetService(ChoiceSetRepository(session))
    yield service
    await session.commit()


ServiceDep = Annotated[ChoiceSetService, Depends(get_service, scope="function")]


@router.get("", response_model=list[ChoiceSetSummaryOut])
async def list_choice_sets(
    service: ServiceDep,
    include_inactive: bool = False,
) -> list[ChoiceSetSummaryOut]:
    return await service.list_sets(include_inactive=include_inactive)


@router.post(
    "",
    response_model=ChoiceSetSummaryOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_choice_set(
    data: ChoiceSetCreateIn, service: ServiceDep
) -> ChoiceSetSummaryOut:
    return await service.create_set(data)


@router.get("/{set_code}", response_model=ChoiceSetSummaryOut)
async def get_choice_set(set_code: str, service: ServiceDep) -> ChoiceSetSummaryOut:
    return await service.get_set(set_code)


@router.patch("/{set_code}", response_model=ChoiceSetSummaryOut)
async def patch_choice_set(
    set_code: str, data: ChoiceSetPatchIn, service: ServiceDep
) -> ChoiceSetSummaryOut:
    return await service.patch_set(set_code, data)


@router.get("/{set_code}/options", response_model=ChoiceOptionPageOut)
async def list_options(
    set_code: str,
    service: ServiceDep,
    q: Annotated[str | None, Query(max_length=128)] = None,
    version: Annotated[int | None, Query(ge=1)] = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    include_inactive: bool = False,
) -> ChoiceOptionPageOut:
    return await service.list_options(
        set_code,
        q=q,
        version=version,
        cursor=cursor,
        limit=limit,
        include_inactive=include_inactive,
    )


@router.post(
    "/{set_code}/options",
    response_model=ChoiceOptionMutationOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_choice_option(
    set_code: str, data: ChoiceOptionCreateIn, service: ServiceDep
) -> ChoiceOptionMutationOut:
    return await service.create_option(set_code, data)


@router.patch(
    "/{set_code}/options/{option_code}", response_model=ChoiceOptionMutationOut
)
async def patch_choice_option(
    set_code: str,
    option_code: str,
    data: ChoiceOptionPatchIn,
    service: ServiceDep,
) -> ChoiceOptionMutationOut:
    return await service.patch_option(set_code, option_code, data)


@router.put("/{set_code}/option-order", response_model=ChoiceSetSummaryOut)
async def reorder_options(
    set_code: str, data: ChoiceOptionOrderIn, service: ServiceDep
) -> ChoiceSetSummaryOut:
    return await service.reorder_options(set_code, data)


@router.post("/{set_code}/import/preview", response_model=ChoiceImportPreviewOut)
async def preview_choice_import(
    set_code: str, data: ChoiceImportIn, service: ServiceDep
) -> ChoiceImportPreviewOut:
    return await service.import_preview(set_code, data)


@router.post("/{set_code}/import", response_model=ChoiceImportApplyOut)
async def apply_choice_import(
    set_code: str, data: ChoiceImportIn, service: ServiceDep
) -> ChoiceImportApplyOut:
    return await service.import_apply(set_code, data)
