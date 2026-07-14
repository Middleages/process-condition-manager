"""Parameter registry rules independent of HTTP and persistence."""

import pytest

import app.domain.parameters as parameter_domain
from app.domain.errors import ImmutableFieldError, RuleViolationError
from app.domain.parameters import (
    ValueType,
    ensure_code_immutable,
    snapshot,
    validate_code,
    validate_new_parameter,
    validate_number_bounds,
)


def normalize_number_bounds(
    min_value: str | None, max_value: str | None
) -> tuple[str | None, str | None]:
    function = getattr(parameter_domain, "normalize_number_bounds", None)
    assert function is not None, "normalize_number_bounds must be part of the public domain API"
    return function(min_value, max_value)


def validate_choice_set_binding(
    value_type: ValueType, choice_set_code: str | None
) -> None:
    function = getattr(parameter_domain, "validate_choice_set_binding", None)
    assert function is not None, "validate_choice_set_binding must replace embedded options"
    function(value_type, choice_set_code)


class TestValidateCode:
    def test_normalizes_whitespace(self) -> None:
        assert validate_code("  temp_celsius  ") == "temp_celsius"

    @pytest.mark.parametrize("bad", ["", "   ", "1abc", "Temp", "a-b", "a b"])
    def test_rejects_invalid_format(self, bad: str) -> None:
        with pytest.raises(RuleViolationError):
            validate_code(bad)


class TestCodeImmutable:
    def test_same_code_ok(self) -> None:
        ensure_code_immutable("width", "width")

    def test_none_incoming_ok(self) -> None:
        ensure_code_immutable("width", None)

    def test_changed_code_rejected(self) -> None:
        with pytest.raises(ImmutableFieldError):
            ensure_code_immutable("width", "height")


class TestNumberBounds:
    def test_min_le_max_ok(self) -> None:
        validate_number_bounds("0", "10")

    def test_only_one_bound_ok(self) -> None:
        validate_number_bounds(None, "10")
        validate_number_bounds("0", None)

    def test_min_gt_max_rejected(self) -> None:
        with pytest.raises(RuleViolationError) as raised:
            validate_number_bounds("10", "1")
        assert raised.value.code == "number_bounds"

    def test_normalizes_without_binary_float_rounding(self) -> None:
        assert normalize_number_bounds(" 001.5000 ", "10.000") == ("1.5", "10")


class TestChoiceSetBinding:
    def test_choice_requires_set(self) -> None:
        with pytest.raises(RuleViolationError) as raised:
            validate_choice_set_binding(ValueType.CHOICE, None)
        assert raised.value.code == "choice_set_required"

    def test_choice_with_set_ok(self) -> None:
        validate_choice_set_binding(ValueType.CHOICE, "equipment_mode")

    def test_non_choice_with_set_rejected(self) -> None:
        with pytest.raises(RuleViolationError) as raised:
            validate_choice_set_binding(ValueType.NUMBER, "equipment_mode")
        assert raised.value.code == "choice_set_not_allowed"


class TestValidateNewParameter:
    def test_returns_normalized_code(self) -> None:
        code = validate_new_parameter(
            code=" exposure_dose ",
            value_type=ValueType.NUMBER,
            min_value="1.0",
            max_value="5.0",
        )
        assert code == "exposure_dose"

    def test_choice_without_set_rejected(self) -> None:
        with pytest.raises(RuleViolationError):
            validate_new_parameter(code="mask", value_type=ValueType.CHOICE)


class TestSnapshot:
    def test_excludes_inactive_and_orders_deterministically(self) -> None:
        result = snapshot(
            categories=[
                {"code": "b", "display_name": "B", "sort_order": 2},
                {"code": "a", "display_name": "A", "sort_order": 1},
                {"code": "z", "display_name": "Z", "sort_order": 0, "is_active": False},
            ],
            parameters=[
                {
                    "code": "p2",
                    "display_name": "P2",
                    "value_type": ValueType.TEXT,
                    "sort_order": 2,
                },
                {
                    "code": "p1",
                    "display_name": "P1",
                    "value_type": ValueType.CHOICE,
                    "sort_order": 1,
                    "category_code": "a",
                    "options": [
                        {"value": "v2", "display_name": "V2", "sort_order": 2},
                        {"value": "v1", "display_name": "V1", "sort_order": 1},
                    ],
                },
            ],
        )
        assert result["version"] == 1
        assert [c["code"] for c in result["categories"]] == ["a", "b"]
        assert [p["code"] for p in result["parameters"]] == ["p1", "p2"]
        assert result["parameters"][0]["value_type"] == "choice"
        assert [o["value"] for o in result["parameters"][0]["options"]] == ["v1", "v2"]
