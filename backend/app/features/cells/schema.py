"""셀 편집 저장 API 스키마 (Pydantic v2).

요청은 더티 셀 배치(condition_id × parameter_code → value)와 출처(origin)를
싣고, 응답은 셀별 서버 확정 값 + batch_id를 돌려준다 — 프론트가 더티 상태를
해제하고 붙여넣기 묶음(Phase 4)을 식별하는 근거가 된다.
"""

from typing import Literal

from pydantic import BaseModel, Field


class CellUpdateIn(BaseModel):
    """더티 셀 한 개. value는 명시적 null(셀 비우기)을 허용한다."""

    condition_id: int
    parameter_code: str
    value: str | None


class CellsPatchIn(BaseModel):
    """셀 배치 저장 요청.

    origin은 "manual"(직접 입력) 또는 "paste"(범위 붙여넣기) — 이벤트 payload에
    실려 Phase 4의 "붙여넣기 묶음 표시"의 근거가 된다.
    """

    cells: list[CellUpdateIn] = Field(default_factory=list)
    origin: Literal["manual", "paste"] = "manual"


class CellOut(BaseModel):
    """서버 확정 셀 값 한 개 (정규화 후). 프론트 더티 해제용."""

    condition_id: int
    parameter_code: str
    value: str | None


class CellsPatchOut(BaseModel):
    """셀 배치 저장 응답: 셀별 확정 값 + 이 요청의 batch_id."""

    cells: list[CellOut]
    batch_id: str
