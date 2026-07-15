"""Parameter registry rules independent of HTTP and persistence."""

import pytest

import app.domain.parameters as parameter_domain
from app.domain.errors import ImmutableFieldError, RuleViolationError
from app.domain.parameters import (
    ValueType,
    ensure_code_immutable,
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


def validate_choice_set_binding(value_type: ValueType, choice_set_code: str | None) -> None:
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

    def test_text_pattern_requires_a_nonblank_paired_hint(self) -> None:
        with pytest.raises(RuleViolationError) as missing:
            validate_new_parameter(
                code="mask_id",
                value_type=ValueType.TEXT,
                pattern="[A-Z]{2}-[0-9]{4}",
            )
        with pytest.raises(RuleViolationError) as blank:
            validate_new_parameter(
                code="mask_id",
                value_type=ValueType.TEXT,
                pattern="[A-Z]{2}-[0-9]{4}",
                pattern_hint="   ",
            )

        assert missing.value.code == "pattern_hint_required"
        assert blank.value.code == "pattern_hint_required"

    def test_hint_without_pattern_is_rejected(self) -> None:
        with pytest.raises(RuleViolationError) as raised:
            validate_new_parameter(
                code="mask_id",
                value_type=ValueType.TEXT,
                pattern_hint="영문 대문자 2자리-숫자 4자리",
            )

        assert raised.value.code == "pattern_required"

    def test_pattern_must_be_portable_and_text_only(self) -> None:
        with pytest.raises(RuleViolationError) as non_portable:
            validate_new_parameter(
                code="mask_id",
                value_type=ValueType.TEXT,
                pattern="(a+)+",
                pattern_hint="안전한 형식",
            )
        with pytest.raises(RuleViolationError) as non_text:
            validate_new_parameter(
                code="dose",
                value_type=ValueType.NUMBER,
                pattern="[0-9]{1,3}",
                pattern_hint="숫자 1~3자리",
            )

        assert non_portable.value.code == "portable_pattern_invalid"
        assert non_text.value.code == "pattern_not_allowed"

    @pytest.mark.parametrize(
        ("value_type", "metadata"),
        [
            (ValueType.TEXT, {"unit": "nm"}),
            (ValueType.TEXT, {"min_value": "0"}),
            (ValueType.CHOICE, {"max_value": "10", "choice_set_code": "mode"}),
        ],
    )
    def test_numeric_metadata_is_number_only(
        self,
        value_type: ValueType,
        metadata: dict[str, str],
    ) -> None:
        with pytest.raises(RuleViolationError) as raised:
            validate_new_parameter(
                code="metadata_owner",
                value_type=value_type,
                **metadata,
            )

        assert raised.value.code == "number_metadata_not_allowed"

    def test_valid_text_pattern_and_number_metadata_are_accepted(self) -> None:
        assert (
            validate_new_parameter(
                code="mask_id",
                value_type=ValueType.TEXT,
                pattern="[A-Z]{2}-[0-9]{4}",
                pattern_hint="영문 대문자 2자리-숫자 4자리",
            )
            == "mask_id"
        )
        assert (
            validate_new_parameter(
                code="dose",
                value_type=ValueType.NUMBER,
                unit="mJ",
                min_value="0",
                max_value="100",
            )
            == "dose"
        )
