"""파라미터 레지스트리 순수 규칙 단위 테스트 (DB 무의존)."""

import pytest

from app.domain.errors import ImmutableFieldError, RuleViolationError
from app.domain.parameters import (
    ValueType,
    ensure_code_immutable,
    snapshot,
    validate_choice_options,
    validate_code,
    validate_new_parameter,
    validate_number_bounds,
)


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
        validate_number_bounds(0.0, 10.0)

    def test_only_one_bound_ok(self) -> None:
        validate_number_bounds(None, 10.0)
        validate_number_bounds(0.0, None)

    def test_min_gt_max_rejected(self) -> None:
        with pytest.raises(RuleViolationError):
            validate_number_bounds(10.0, 1.0)


class TestChoiceOptions:
    def test_choice_requires_option(self) -> None:
        with pytest.raises(RuleViolationError):
            validate_choice_options(ValueType.CHOICE, [])

    def test_choice_with_options_ok(self) -> None:
        validate_choice_options(ValueType.CHOICE, ["a", "b"])

    def test_non_choice_with_options_rejected(self) -> None:
        with pytest.raises(RuleViolationError):
            validate_choice_options(ValueType.NUMBER, ["a"])

    def test_duplicate_option_values_rejected(self) -> None:
        with pytest.raises(RuleViolationError):
            validate_choice_options(ValueType.CHOICE, ["a", "a"])


class TestValidateNewParameter:
    def test_returns_normalized_code(self) -> None:
        code = validate_new_parameter(
            code=" exposure_dose ", value_type=ValueType.NUMBER,
            min_value=1.0, max_value=5.0,
        )
        assert code == "exposure_dose"

    def test_choice_without_option_rejected(self) -> None:
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
                    "code": "p2", "display_name": "P2", "value_type": ValueType.TEXT,
                    "sort_order": 2,
                },
                {
                    "code": "p1", "display_name": "P1", "value_type": ValueType.CHOICE,
                    "sort_order": 1, "category_code": "a",
                    "options": [
                        {"value": "v2", "display_name": "V2", "sort_order": 2},
                        {"value": "v1", "display_name": "V1", "sort_order": 1},
                    ],
                },
            ],
        )
        assert result["version"] == 1
        # 비활성 카테고리 z 제외, sort_order 순
        assert [c["code"] for c in result["categories"]] == ["a", "b"]
        # 파라미터도 sort_order 순, value_type 문자열화
        assert [p["code"] for p in result["parameters"]] == ["p1", "p2"]
        assert result["parameters"][0]["value_type"] == "choice"
        # 선택지 정렬
        assert [o["value"] for o in result["parameters"][0]["options"]] == ["v1", "v2"]
