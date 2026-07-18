"""Authenticated, read-only history routes."""

from __future__ import annotations

import logging
from time import perf_counter
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.db import get_app_session
from app.features.history.repository import HistoryRepository
from app.features.history.schema import (
    HistoryCellHistoryOut,
    HistoryCellHistoryQueryIn,
    HistoryDetailOut,
    HistoryDetailQueryIn,
    HistoryTimelineOut,
    HistoryTimelineQueryIn,
)
from app.features.history.service import HistoryService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects",
    tags=["history"],
    dependencies=[Depends(get_current_user)],
)


def get_service(
    session: Annotated[AsyncSession, Depends(get_app_session, scope="function")],
) -> HistoryService:
    return HistoryService(HistoryRepository(session))


ServiceDep = Annotated[HistoryService, Depends(get_service, scope="function")]


def _log_summary(route: str, started: float, count: int) -> None:
    logger.info(
        "history_request_summary",
        extra={
            "route": route,
            "duration_ms": round((perf_counter() - started) * 1000, 3),
            "count": count,
            "status": 200,
        },
    )


@router.get("/{project_id}/events", response_model=HistoryTimelineOut)
async def list_events(
    project_id: int,
    query: Annotated[HistoryTimelineQueryIn, Query()],
    service: ServiceDep,
) -> HistoryTimelineOut:
    started = perf_counter()
    result = await service.list_events(project_id, query)
    _log_summary("timeline", started, len(result.items))
    return result


@router.get("/{project_id}/event-batches/{batch_id}", response_model=HistoryDetailOut)
async def get_event_batch(
    project_id: int,
    batch_id: str,
    query: Annotated[HistoryDetailQueryIn, Query()],
    service: ServiceDep,
) -> HistoryDetailOut:
    started = perf_counter()
    result = await service.get_batch(project_id, batch_id, query)
    _log_summary("batch_detail", started, len(result.items))
    return result


@router.get("/{project_id}/cell-history", response_model=HistoryCellHistoryOut)
async def get_cell_history(
    project_id: int,
    service: ServiceDep,
    condition_id: Annotated[int, Query(ge=1)],
    parameter_code: Annotated[str, Query(min_length=1, max_length=64)],
    cursor: Annotated[str | None, Query(min_length=1, max_length=4096)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> HistoryCellHistoryOut:
    started = perf_counter()
    query = HistoryCellHistoryQueryIn(
        condition_id=condition_id,
        parameter_code=parameter_code,
        cursor=cursor,
        limit=limit,
    )
    result = await service.get_cell_history(project_id, query)
    _log_summary("cell_history", started, len(result.items))
    return result
