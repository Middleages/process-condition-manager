import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.database import async_session
from app.routers import (
    users, lines, columns, products,
    projects, project_conditions, project_layers, project_lifecycle,
    admin, comments, export, export_admin, equipment, auth as auth_router,
    dashboard,
)

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
    return {"status": "ok", "app": settings.APP_NAME, "db": db_status}


app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(users.router)
app.include_router(lines.router)
app.include_router(columns.router)
app.include_router(products.router)
app.include_router(projects.router)
app.include_router(project_conditions.router)
app.include_router(project_layers.router)
app.include_router(project_lifecycle.router)
app.include_router(comments.router)
app.include_router(admin.router)
app.include_router(export_admin.router)
app.include_router(export.router)
app.include_router(equipment.router)
app.include_router(dashboard.router)
