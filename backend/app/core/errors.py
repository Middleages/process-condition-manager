"""공통 예외 및 HTTP 매핑.

도메인/기능 계층은 프레임워크 무의존 예외(AppError 계열)를 던지고,
여기서 FastAPI 예외 핸들러로 HTTP 응답에 매핑한다.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """애플리케이션 기본 예외."""

    status_code: int = 500
    code: str = "internal_error"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code


class NotFoundError(AppError):
    """리소스를 찾을 수 없음."""

    status_code = 404
    code = "not_found"


class ConflictError(AppError):
    """상태 충돌 (예: 편집 잠금 미보유)."""

    status_code = 409
    code = "conflict"


class DomainValidationError(AppError):
    """도메인 규칙 위반."""

    status_code = 422
    code = "validation_error"


async def _app_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """AppError 계열 예외를 표준 JSON 오류 응답으로 변환한다."""
    assert isinstance(exc, AppError)  # register 시점에 AppError로만 배선됨
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


def register_exception_handlers(app: FastAPI) -> None:
    """앱에 공통 예외 핸들러를 등록한다."""
    app.add_exception_handler(AppError, _app_error_handler)
