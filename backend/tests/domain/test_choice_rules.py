import pytest

from app.domain.choices.cursor import ChoiceCursor, decode_choice_cursor, encode_choice_cursor
from app.domain.choices.rules import (
    normalize_choice_option,
    validate_complete_order,
)
from app.domain.errors import RuleViolationError


def test_option_code_is_trimmed_exact_and_uppercase_is_valid() -> None:
    assert normalize_choice_option(" FOUNDRY ", " Foundry ") == ("FOUNDRY", "Foundry")


@pytest.mark.parametrize("code", ["", " ", "X" * 129])
def test_option_code_must_be_non_empty_and_bounded(code: str) -> None:
    with pytest.raises(RuleViolationError):
        normalize_choice_option(code, "Label")


@pytest.mark.parametrize("code", ["A/B", "A%2FB", ".", "..", "한글", "A B"])
def test_path_unsafe_codes_are_rejected_consistently(code: str) -> None:
    with pytest.raises(RuleViolationError):
        normalize_choice_option(code, "Label")


def test_reorder_requires_every_code_once() -> None:
    validate_complete_order(["A", "B"], {"A", "B"})
    with pytest.raises(RuleViolationError, match="모든"):
        validate_complete_order(["A", "A"], {"A", "B"})


def test_cursor_round_trips_version_and_position() -> None:
    cursor = ChoiceCursor(version=7, sort_order=20, code="SPECIAL")
    assert decode_choice_cursor(encode_choice_cursor(cursor)) == cursor
    with pytest.raises(RuleViolationError):
        decode_choice_cursor("not-a-cursor")
