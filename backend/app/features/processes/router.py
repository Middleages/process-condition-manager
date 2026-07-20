"""공정/layer 조회 라우터."""

from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_business_read
from app.core.db import get_app_session
from app.features.processes.schema import (
    LayerOut,
    ProcessDetailOut,
    ProcessListOut,
)
from app.features.processes.service import ProcessService
from app.features.projects.repository import ProjectRepository
from app.ingest.fixture_reader import get_ingest_reader
from app.ingest.reader import IngestReader

router = APIRouter(
    prefix="/processes",
    tags=["processes"],
    dependencies=[Depends(get_current_user)],
)


def get_service(
    reader: Annotated[IngestReader, Depends(get_ingest_reader)],
    session: Annotated[AsyncSession, Depends(get_app_session)],
) -> ProcessService:
    return ProcessService(reader, ProjectRepository(session))


ServiceDep = Annotated[ProcessService, Depends(get_service)]


@router.get(
    "",
    response_model=ProcessListOut,
    dependencies=[Depends(require_business_read)],
)
async def list_processes(
    service: ServiceDep,
    query: str | None = None,
    cursor: str | None = None,
    limit: int = 50,
    without_project: bool = False,
) -> ProcessListOut:
    limit = max(1, min(limit, 200))
    items, next_cursor = await service.search_processes(
        query=query, cursor=cursor, limit=limit, without_project=without_project
    )
    return ProcessListOut(items=items, next_cursor=next_cursor)


@router.get(
    "/{process_key}",
    response_model=ProcessDetailOut,
    dependencies=[Depends(require_business_read)],
)
async def get_process(process_key: str, service: ServiceDep) -> ProcessDetailOut:
    return await service.get_process_detail(process_key)


@router.get(
    "/{process_key}/layers",
    response_model=list[LayerOut],
    dependencies=[Depends(require_business_read)],
)
async def get_layers(process_key: str, service: ServiceDep) -> list[LayerOut]:
    layers = await service.get_layers(process_key)
    return [LayerOut(**asdict(layer)) for layer in layers]
