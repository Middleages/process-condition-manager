"""도메인 예외 (프레임워크 무의존).

도메인 규칙 위반은 여기 정의된 예외로 표현한다. HTTP 매핑은
core/errors.py의 핸들러가 담당한다 (도메인은 HTTP를 알지 못한다).
"""


class DomainError(Exception):
    """도메인 규칙 위반 기본 예외."""

    code: str = "domain_error"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code


class ImmutableFieldError(DomainError):
    """불변 필드를 변경하려 함 (예: parameter.code)."""

    code = "immutable_field"


class RuleViolationError(DomainError):
    """무결성 규칙 위반 (예: choice 타입인데 선택지가 없음)."""

    code = "rule_violation"
