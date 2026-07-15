import re
from decimal import Decimal

from app.domain.errors import RuleViolationError

_DECIMAL_PATTERN = re.compile(r"^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$")
MAX_DECIMAL_INPUT_LENGTH = 256
MAX_DECIMAL_DIGITS = 128


def normalize_decimal(raw: str) -> str:
    text = raw.strip()
    if not text or len(text) > MAX_DECIMAL_INPUT_LENGTH or not _DECIMAL_PATTERN.fullmatch(text):
        raise RuleViolationError("허용된 소수 형식이 아니다", code="invalid_decimal")
    if sum("0" <= char <= "9" for char in text) > MAX_DECIMAL_DIGITS:
        raise RuleViolationError("소수 자릿수 제한을 초과했다", code="invalid_decimal")

    negative = text.startswith("-")
    unsigned = text[1:] if negative else text
    integer, dot, fraction = unsigned.partition(".")
    integer = (integer or "0").lstrip("0") or "0"
    fraction = fraction.rstrip("0") if dot else ""
    canonical = integer if fraction == "" else f"{integer}.{fraction}"
    if canonical == "0":
        return "0"
    return f"-{canonical}" if negative else canonical


def normalize_optional_decimal(raw: str | None) -> str | None:
    if raw is None or raw.strip() == "":
        return None
    return normalize_decimal(raw)


def compare_canonical_decimals(left: str, right: str) -> int:
    left_value = Decimal(normalize_decimal(left))
    right_value = Decimal(normalize_decimal(right))
    return (left_value > right_value) - (left_value < right_value)
