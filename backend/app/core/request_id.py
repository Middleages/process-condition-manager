"""Per-request correlation identifier boundary."""

from uuid import UUID, uuid4

from fastapi import Request
from fastapi.responses import JSONResponse, Response

_HEADER = "X-Request-ID"


async def request_id_middleware(request: Request, call_next) -> Response:
    values = [
        value.decode("latin-1")
        for name, value in request.scope.get("headers", ())
        if name.lower() == b"x-request-id"
    ]
    if len(values) > 1:
        return _invalid_request_id()

    if values:
        try:
            request_id = str(UUID(values[0]))
        except (ValueError, AttributeError):
            return _invalid_request_id()
    else:
        request_id = str(uuid4())

    request.state.request_id = request_id
    response = await call_next(request)
    response.headers[_HEADER] = request_id
    return response


def _invalid_request_id() -> JSONResponse:
    request_id = str(uuid4())
    return JSONResponse(
        status_code=400,
        content={
            "code": "invalid_request_id",
            "message": "X-Request-ID must occur once and contain a valid UUID",
        },
        headers={_HEADER: request_id},
    )
