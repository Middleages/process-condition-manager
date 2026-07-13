"""조건 행 관리 API 스키마 (Pydantic v2).

추가/복제 요청은 선택적 복제 원본(source_condition_id)만 싣는다 — None/생략이면
빈 조건 행을 추가하고, 값이 있으면 그 조건 행을 복제한다. 삭제/POR 이양은 대상이
경로(condition_id)로 식별되므로 본문이 없다. 응답은 조건 행의 최소 표현으로,
프론트가 새 행을 그리드에 반영하거나 POR 표시를 갱신하는 데 필요한 값만 담는다.
"""

from pydantic import BaseModel


class ConditionCreateIn(BaseModel):
    """조건 행 추가/복제 요청.

    source_condition_id가 None/생략이면 빈 조건 행을 추가하고, 값이 있으면 그
    조건 행(같은 layer 소속이어야 함)의 셀 값을 전부 복사해 새 행을 만든다.
    """

    source_condition_id: int | None = None


class ConditionOut(BaseModel):
    """조건 행 한 개의 최소 표현 (추가/POR 이양 응답)."""

    id: int
    layer_key: str
    label: str
    condition_index: int
    is_por: bool
