"""FastAPI 앱 조립.

비즈니스 로직 금지 — 헬스체크와 라우터 등록만 담당한다.
기능은 features/ 수직 슬라이스가 각자의 라우터로 여기에 등록한다.
"""

from fastapi import APIRouter, FastAPI

from app.core.config import settings
from app.core.db import app_engine, ingest_engine
from app.core.errors import register_exception_handlers
from app.features.parameters.router import router as parameters_router
from app.features.processes.router import router as processes_router

health_router = APIRouter(tags=["health"])


@health_router.get("/health")
async def health() -> dict[str, str]:
    """라이브니스 체크 (DB 미접속)."""
    return {"status": "ok", "app": settings.app_name}


def create_app() -> FastAPI:
    """앱 인스턴스를 생성/조립한다."""
    app = FastAPI(title=settings.app_name, debug=settings.debug)
    register_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(parameters_router)
    app.include_router(processes_router)

    # 이중 엔진 참조 보관 (실사용은 각 feature/ingest가 세션 의존성으로 접근)
    app.state.app_engine = app_engine
    app.state.ingest_engine = ingest_engine
    return app


app = create_app()
