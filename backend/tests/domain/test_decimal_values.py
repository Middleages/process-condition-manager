import pytest

from app.domain.decimal_values import (
    compare_canonical_decimals,
    normalize_decimal,
    normalize_optional_decimal,
)
from app.domain.errors import RuleViolationError


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (" 001.5000 ", "1.5"),
        (".5", "0.5"),
        ("1.", "1"),
        ("-0.000", "0"),
        ("-.5000", "-0.5"),
        ("000", "0"),
    ],
)
def test_normalize_decimal_golden_vectors(raw: str, expected: str) -> None:
    assert normalize_decimal(raw) == expected


@pytest.mark.parametrize(
    "raw",
    ["+1", "1e3", "1,000", "1_000", "NaN", "Infinity", "--1", ".", "١", "１"],
)
def test_normalize_decimal_rejects_non_contract_spellings(raw: str) -> None:
    with pytest.raises(RuleViolationError, match="소수") as raised:
        normalize_decimal(raw)
    assert raised.value.code == "invalid_decimal"


def test_decimal_length_digit_and_optional_boundaries() -> None:
    assert normalize_decimal("9" * 128) == "9" * 128
    with pytest.raises(RuleViolationError):
        normalize_decimal("9" * 129)
    with pytest.raises(RuleViolationError):
        normalize_decimal("0" * 256 + ".1")
    assert normalize_optional_decimal("  ") is None
    assert normalize_optional_decimal(None) is None


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [("-10", "-2", -1), ("0.5", "0.50", 0), ("99.9", "100", -1), ("2", "-1", 1)],
)
def test_compare_canonical_decimals(left: str, right: str, expected: int) -> None:
    assert compare_canonical_decimals(left, right) == expected
