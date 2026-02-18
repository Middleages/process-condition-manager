"""값 비교 유틸리티 - JSONB 조건 데이터의 수치 정규화 비교."""

from typing import Any


def normalize_value(val: Any) -> Any:
    """비교 목적으로 값을 정규화한다.

    - None 및 빈 문자열은 None으로 통일
    - 정수로 표현 가능한 float/문자열은 int로 변환 (예: 490.0 -> 490)
    - NaN은 None으로 처리하지 않고 float 그대로 유지 (비교 시 항상 다름)
    """
    if val is None:
        return None
    if isinstance(val, str):
        val = val.strip()
        if val == "":
            return None
        try:
            num = float(val)
            if num == int(num) and not (num != num):  # NaN 아닌 경우
                return int(num)
            return num
        except (ValueError, OverflowError):
            return val
    if isinstance(val, float):
        if val == int(val) and not (val != val):  # NaN 아닌 경우
            return int(val)
        return val
    return val


def values_differ(old_val: Any, new_val: Any) -> bool:
    """수치 정규화를 포함하여 두 값이 다른지 비교한다.

    490 vs 490.0, "490" vs 490 등의 거짓 양성(false positive)을 방지한다.
    """
    norm_old = normalize_value(old_val)
    norm_new = normalize_value(new_val)
    if norm_old is None and norm_new is None:
        return False
    if norm_old is None or norm_new is None:
        return True
    return str(norm_old) != str(norm_new)
