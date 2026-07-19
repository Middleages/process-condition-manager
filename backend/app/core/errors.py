"""공통 예외 및 HTTP 매핑.

도메인/기능 계층은 프레임워크 무의존 예외(AppError 계열)를 던지고,
여기서 FastAPI 예외 핸들러로 HTTP 응답에 매핑한다.
"""

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.domain.errors import DomainError


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
        details: dict | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}
        self.headers = headers or {}
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


class LockConflictError(AppError):
    """편집 잠금 충돌 (미보유/토큰 불일치/만료).

    프론트가 일반 409(conflict)와 구분해 "잠금 재획득" 흐름을 띄울 수 있도록
    별도 code를 쓴다. 보유자 정보는 details에 (JSON 안전한 형태로) 싣는다.
    """

    status_code = 409
    code = "lock_conflict"


class DomainValidationError(AppError):
    """도메인 규칙 위반."""

    status_code = 422
    code = "validation_error"


class ProjectReadOnlyError(AppError):
    """Non-draft 프로젝트 편집/락 시도 차단."""

    status_code = 409
    code = "project_read_only"


async def _app_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """AppError 계열 예외를 표준 JSON 오류 응답으로 변환한다."""
    assert isinstance(exc, AppError)  # register 시점에 AppError로만 배선됨
    content: dict = {"code": exc.code, "message": exc.message}
    if exc.details:
        content["details"] = exc.details
    return JSONResponse(status_code=exc.status_code, content=content, headers=exc.headers)


async def _domain_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """도메인 규칙 위반(DomainError)을 422로 매핑한다."""
    assert isinstance(exc, DomainError)  # register 시점에 DomainError로만 배선됨
    return JSONResponse(
        status_code=422,
        content={"code": exc.code, "message": exc.message},
    )


async def _request_validation_error_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    action_error = request.url.path.endswith("/transitions") and any(
        tuple(error.get("loc", ())) == ("body", "action") for error in exc.errors()
    )
    if action_error:
        return JSONResponse(
            status_code=422,
            content={
                "code": "workflow_action_invalid",
                "message": "지원하지 않는 workflow action입니다",
            },
        )
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})


def register_exception_handlers(app: FastAPI) -> None:
    """앱에 공통 예외 핸들러를 등록한다."""
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(DomainError, _domain_error_handler)
    app.add_exception_handler(RequestValidationError, _request_validation_error_handler)
