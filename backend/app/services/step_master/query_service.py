"""Step Master query service.

Project 생성 시 레이어 선택 소스를 `layer_master`에서 `step_current`로
점진 전환하기 위한 조회 함수들을 제공한다.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.step_master import EtlRunLog, StepCurrent


def _natural_sort_key(value: str | None) -> tuple[int, Decimal | str]:
    """숫자형 문자열은 수치 정렬, 그 외는 문자열 정렬."""
    if value is None:
        return (2, "")
    try:
        return (0, Decimal(value))
    except (InvalidOperation, ValueError):
        return (1, value)


async def get_step_layers(
    db: AsyncSession,
    line_id: int,
    process_id: str,
) -> list[StepCurrent]:
    """step_current에서 (line_id, process_id) 기준 레이어 목록 조회."""
    result = await db.execute(
        select(StepCurrent)
        .where(
            StepCurrent.line_id == line_id,
            StepCurrent.process_id == process_id,
        )
    )
    rows = list(result.scalars().all())
    rows.sort(key=lambda r: (_natural_sort_key(r.layer_id), _natural_sort_key(r.step_seq)))
    return rows


async def get_last_successful_full_sync_at(db: AsyncSession) -> datetime | None:
    """`full_to_current_hourly` DAG의 최근 성공 finished_at 시각을 반환."""
    result = await db.execute(
        select(EtlRunLog.finished_at)
        .where(
            EtlRunLog.dag_id == "full_to_current_hourly",
            EtlRunLog.status == "success",
            EtlRunLog.finished_at.is_not(None),
        )
        .order_by(EtlRunLog.finished_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def is_within_freshness_sla(
    *,
    last_success_at: datetime | None,
    now_utc: datetime,
    sla_minutes: int,
) -> bool:
    """최근 성공 시각이 SLA 이내인지 판정."""
    if last_success_at is None:
        return False

    if last_success_at.tzinfo is None:
        last_success_at = last_success_at.replace(tzinfo=timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)

    return now_utc - last_success_at <= timedelta(minutes=sla_minutes)
