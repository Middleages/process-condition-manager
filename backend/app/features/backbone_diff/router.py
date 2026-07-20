"""Authenticated backbone diff routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_business_read
from app.core.db import get_app_session
from app.features.backbone_diff.provider import BackboneDiffProvider, build_backbone_diff_provider
from app.features.backbone_diff.schema import (
    BackboneDiffBranchQueryIn,
    BackboneDiffCellPageOut,
    BackboneDiffCellQueryIn,
    BackboneDiffConditionPageOut,
    BackboneDiffRootOut,
    BackboneDiffRootQueryIn,
)
from app.features.backbone_diff.service import BackboneDiffService

router = APIRouter(
    prefix="/projects",
    tags=["backbone-diff"],
    dependencies=[Depends(get_current_user)],
)


def _build_provider(session: AsyncSession) -> BackboneDiffProvider:
    return build_backbone_diff_provider(session)


def get_service(
    session: Annotated[AsyncSession, Depends(get_app_session, scope="function")],
) -> BackboneDiffService:
    return BackboneDiffService(_build_provider(session))


ServiceDep = Annotated[BackboneDiffService, Depends(get_service, scope="function")]


@router.get(
    "/{project_id}/backbone-diff",
    response_model=BackboneDiffRootOut,
    dependencies=[Depends(require_business_read)],
)
async def get_backbone_diff(
    project_id: int,
    query: Annotated[BackboneDiffRootQueryIn, Query()],
    service: ServiceDep,
) -> BackboneDiffRootOut:
    return await service.root(project_id, query)


@router.get(
    "/{project_id}/backbone-diff/layers/{layer_key}/conditions",
    response_model=BackboneDiffConditionPageOut,
    dependencies=[Depends(require_business_read)],
)
async def get_backbone_diff_conditions(
    project_id: int,
    layer_key: Annotated[str, Path(min_length=1, max_length=256)],
    query: Annotated[BackboneDiffBranchQueryIn, Query()],
    service: ServiceDep,
) -> BackboneDiffConditionPageOut:
    return await service.conditions(project_id, layer_key, query)


@router.get(
    "/{project_id}/backbone-diff/layers/{layer_key}/conditions/{row_ref}/cells",
    response_model=BackboneDiffCellPageOut,
    dependencies=[Depends(require_business_read)],
)
async def get_backbone_diff_cells(
    project_id: int,
    layer_key: Annotated[str, Path(min_length=1, max_length=256)],
    row_ref: Annotated[str, Path(min_length=1, max_length=4096)],
    query: Annotated[BackboneDiffCellQueryIn, Query()],
    service: ServiceDep,
) -> BackboneDiffCellPageOut:
    return await service.cells(project_id, layer_key, row_ref, query)
