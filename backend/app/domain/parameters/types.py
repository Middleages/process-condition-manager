"""파라미터 값 타입."""

from enum import StrEnum


class ValueType(StrEnum):
    """파라미터가 담는 값의 종류.

    - NUMBER: 숫자 (unit/min/max 부가 속성을 가질 수 있음)
    - TEXT:   자유 문자열
    - CHOICE: 선택지 목록 중 하나 (최소 1개 option 필요)
    """

    NUMBER = "number"
    TEXT = "text"
    CHOICE = "choice"
