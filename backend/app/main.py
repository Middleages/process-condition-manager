import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.logging_config import setup_logging

# 라우터 import 전에 로깅 설정 (로거 초기화 순서 보장)
setup_logging(environment=settings.ENVIRONMENT, log_level=settings.LOG_LEVEL)

from app.database import async_session  # noqa: E402
from app.routers import auth as auth_router  # noqa: E402
from app.routers.admin import router as admin_router  # noqa: E402
from app.routers.api import router as api_router  # noqa: E402
from app.routers.projects import router as project_router  # noqa: E402

logger = logging.getLogger(__name__)

app = FastAPI(title=settings.APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "서버 내부 오류가 발생했습니다."},
    )


@app.get("/api/health")
async def health_check():
    try:
        async with async_session() as session:
            await session.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception:
        db_status = "disconnected"

    status = "ok" if db_status == "connected" else "degraded"
    return {
        "status": status,
        "app": settings.APP_NAME,
        "db": db_status,
        "environment": settings.ENVIRONMENT,
    }


app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(admin_router)
app.include_router(project_router)
app.include_router(api_router)
