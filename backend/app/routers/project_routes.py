from fastapi import APIRouter

from app.routers import (
    comments,
    export_projects,
    project_conditions,
    project_layers,
    project_lifecycle,
    projects,
)

router = APIRouter(prefix="/api")

router.include_router(projects.router)
router.include_router(project_conditions.router)
router.include_router(project_layers.router)
router.include_router(project_lifecycle.router)
router.include_router(comments.router)
router.include_router(export_projects.router)
