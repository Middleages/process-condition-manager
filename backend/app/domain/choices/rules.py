"""Pure identity, label, ordering, and resolution rules for managed choices."""

import re
from dataclasses import dataclass
from typing import Final

from app.domain.errors import RuleViolationError

_CHOICE_CODE_PATTERN: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


@dataclass(frozen=True, slots=True)
class ResolvedChoice:
    """Framework/ORM-independent result returned to choice consumers."""

    set_code: str
    option_code: str
    label: str
    set_is_active: bool
    option_is_active: bool

    @property
    def effective_is_active(self) -> bool:
        return self.set_is_active and self.option_is_active


def normalize_choice_code(raw: str, max_length: int) -> str:
    """Trim and validate an exact, URL-segment-safe ASCII business identity."""
    code = raw.strip()
    if (
        not code
        or len(code) > max_length
        or code in {".", ".."}
        or _CHOICE_CODE_PATTERN.fullmatch(code) is None
    ):
        raise RuleViolationError(
            "선택지 code는 URL 경로에 안전한 ASCII 문자여야 한다",
            code="invalid_choice_code",
        )
    return code


def normalize_choice_label(raw: str) -> str:
    label = raw.strip()
    if not label or len(label) > 128:
        raise RuleViolationError(
            "선택지 label은 비어 있지 않은 128자 이하여야 한다",
            code="invalid_choice_label",
        )
    return label


def normalize_choice_option(code: str, label: str) -> tuple[str, str]:
    return normalize_choice_code(code, 128), normalize_choice_label(label)


def normalize_choice_set(code: str, display_name: str) -> tuple[str, str]:
    normalized_name = display_name.strip()
    if not normalized_name or len(normalized_name) > 128:
        raise RuleViolationError(
            "선택지 집합 이름은 비어 있지 않은 128자 이하여야 한다",
            code="invalid_choice_set_name",
        )
    return normalize_choice_code(code, 64), normalized_name


def normalize_choice_description(raw: str | None) -> str | None:
    if raw is None:
        return None
    description = raw.strip()
    if len(description) > 512:
        raise RuleViolationError(
            "선택지 집합 설명은 512자 이하여야 한다",
            code="invalid_choice_set_description",
        )
    return description or None


def validate_complete_order(ordered_codes: list[str], existing_codes: set[str]) -> None:
    """Require every active and inactive code exactly once."""
    if len(ordered_codes) != len(existing_codes) or set(ordered_codes) != existing_codes:
        raise RuleViolationError(
            "모든 선택지 code를 중복 없이 한 번씩 정렬해야 한다",
            code="incomplete_choice_order",
        )
