"""파라미터 레지스트리 순수 규칙 (프레임워크·DB 무의존).

시스템의 축인 레지스트리의 무결성 규칙을 한곳에 모은다. 모든 함수는
원시 값만 받아 규칙 위반 시 도메인 예외를 던진다 (단독 테스트 가능).
"""

import re
from collections.abc import Iterable, Mapping
from typing import Any

from app.domain.decimal_values import compare_canonical_decimals, normalize_optional_decimal
from app.domain.errors import ImmutableFieldError, RuleViolationError
from app.domain.parameters.types import ValueType

# code: 소문자로 시작, 소문자/숫자/밑줄. 셀 값과 이벤트가 전부 이 값으로 참조한다.
_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")

SNAPSHOT_VERSION = 1


def validate_code(code: str) -> str:
    """code 형식을 검증하고 정규화(공백 제거)한다."""
    normalized = code.strip()
    if not normalized:
        raise RuleViolationError("code는 비어 있을 수 없다", code="code_empty")
    if not _CODE_PATTERN.match(normalized):
        raise RuleViolationError(
            "code는 소문자로 시작하고 소문자/숫자/밑줄만 허용된다",
            code="code_format",
        )
    return normalized


def ensure_code_immutable(current: str, incoming: str | None) -> None:
    """수정 시 code 변경을 거부한다. code는 생성 후 불변이다."""
    if incoming is not None and incoming != current:
        raise ImmutableFieldError(
            f"code는 불변이다: {current!r} -> {incoming!r} 변경 불가"
        )


def validate_number_bounds(
    min_value: str | None, max_value: str | None
) -> None:
    """number 타입의 min/max 정합성을 검증한다."""
    if (
        min_value is not None
        and max_value is not None
        and compare_canonical_decimals(min_value, max_value) > 0
    ):
        raise RuleViolationError(
            f"min({min_value})은 max({max_value})보다 클 수 없다",
            code="number_bounds",
        )


def normalize_number_bounds(
    min_value: str | None, max_value: str | None
) -> tuple[str | None, str | None]:
    """Canonicalize optional bounds and enforce their ordering."""
    canonical_min = normalize_optional_decimal(min_value)
    canonical_max = normalize_optional_decimal(max_value)
    validate_number_bounds(canonical_min, canonical_max)
    return canonical_min, canonical_max


def validate_choice_set_binding(
    value_type: ValueType, choice_set_code: str | None
) -> None:
    if value_type is ValueType.CHOICE and choice_set_code is None:
        raise RuleViolationError(
            "choice 타입은 ChoiceSet이 필요하다", code="choice_set_required"
        )
    if value_type is not ValueType.CHOICE and choice_set_code is not None:
        raise RuleViolationError(
            "choice가 아닌 타입은 ChoiceSet을 가질 수 없다",
            code="choice_set_not_allowed",
        )


def validate_new_parameter(
    *,
    code: str,
    value_type: ValueType,
    min_value: str | None = None,
    max_value: str | None = None,
    choice_set_code: str | None = None,
) -> str:
    """생성 시 파라미터 무결성 규칙을 일괄 검증하고 정규화된 code를 반환한다."""
    normalized = validate_code(code)
    normalize_number_bounds(min_value, max_value)
    validate_choice_set_binding(value_type, choice_set_code)
    return normalized


def snapshot(
    *,
    categories: Iterable[Mapping[str, Any]],
    parameters: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """레지스트리 활성 항목을 결정론적 순서로 직렬화한다 (Phase 5 동결에서 사용).

    - is_active=false 항목은 제외한다.
    - 순서는 (sort_order, code)로 결정론적이다.
    - 버전 봉투로 감싸 이후 스키마 변화를 추적한다.
    """

    def _active(rows: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
        return [r for r in rows if r.get("is_active", True)]

    def _key(row: Mapping[str, Any]) -> tuple[int, str]:
        return (int(row.get("sort_order", 0)), str(row.get("code", "")))

    cat_rows = sorted(_active(categories), key=_key)
    param_rows = sorted(_active(parameters), key=_key)

    return {
        "version": SNAPSHOT_VERSION,
        "categories": [
            {
                "code": c["code"],
                "display_name": c["display_name"],
                "sort_order": int(c.get("sort_order", 0)),
            }
            for c in cat_rows
        ],
        "parameters": [
            {
                "code": p["code"],
                "display_name": p["display_name"],
                "value_type": str(p["value_type"]),
                "category_code": p.get("category_code"),
                "unit": p.get("unit"),
                "min_value": p.get("min_value"),
                "max_value": p.get("max_value"),
                "options": [
                    {
                        "value": o["value"],
                        "display_name": o["display_name"],
                        "sort_order": int(o.get("sort_order", 0)),
                    }
                    for o in sorted(
                        _active(p.get("options", [])), key=_key_option
                    )
                ],
            }
            for p in param_rows
        ],
    }


def _key_option(row: Mapping[str, Any]) -> tuple[int, str]:
    return (int(row.get("sort_order", 0)), str(row.get("value", "")))
