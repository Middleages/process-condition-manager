"""시트 조회 API 스키마 (Pydantic v2).

프론트는 이 응답만으로 그리드를 구성한다 (코드가 파라미터를 모른다 — P1 원칙).
컬럼 정의(레지스트리 유래)와 본문(조건 행 × 파라미터 매트릭스)을 분리해 담는다.
"""

from datetime import datetime

from pydantic import BaseModel, Field

from app.domain.parameters.types import ValueType


class SheetColumnOut(BaseModel):
    """그리드 컬럼 정의 한 개 (= live 파라미터 한 개)."""

    parameter_code: str
    display_name: str
    value_type: ValueType
    category_code: str | None
    unit: str | None
    description: str | None
    # choice 타입일 때만 값이 채워진다 (number/text는 빈 리스트).
    choice_options: list[str] = Field(default_factory=list)
    sort_order: int


class SheetRowOut(BaseModel):
    """그리드 행 한 개 (= layer 안의 조건 행 한 개)."""

    condition_id: int
    layer_key: str
    # P1-D3 병기 규칙: "{layer_id} ({step_seq})"
    layer_label: str
    condition_label: str
    is_por: bool
    # parameter_code -> value_text. 값이 없는 셀은 생략한다 (희소 표현).
    cells: dict[str, str | None] = Field(default_factory=dict)


class SheetLockSummaryOut(BaseModel):
    """편집 잠금 요약 — 보유자 표시와 클라이언트 heartbeat 주기용 데이터."""

    locked_by: str | None
    locked_at: datetime | None
    expires_at: datetime | None
    is_mine: bool
    heartbeat_seconds: int


class SheetOut(BaseModel):
    """시트 조회 응답: 컬럼 정의 + 본문 행 + 잠금 요약."""

    columns: list[SheetColumnOut]
    rows: list[SheetRowOut]
    lock: SheetLockSummaryOut
