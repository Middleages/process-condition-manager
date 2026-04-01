"""Step Master query service.

Project 생성 시 레이어 선택 소스를 `layer_master`에서 `step_current`로
점진 전환하기 위한 조회 함수들을 제공한다.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.step_master import StepCurrent


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
