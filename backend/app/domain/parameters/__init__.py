"""파라미터 레지스트리 도메인 규칙 (Phase 0의 핵심).

순수 규칙(code 불변, soft-delete, choice/number 무결성)과 스냅샷 직렬화를
제공한다. FastAPI·SQLAlchemy를 알지 못한다.
"""

from app.domain.parameters.rules import (
    ensure_code_immutable,
    snapshot,
    validate_choice_options,
    validate_code,
    validate_new_parameter,
    validate_number_bounds,
)
from app.domain.parameters.types import ValueType

__all__ = [
    "ValueType",
    "ensure_code_immutable",
    "snapshot",
    "validate_choice_options",
    "validate_code",
    "validate_new_parameter",
    "validate_number_bounds",
]
