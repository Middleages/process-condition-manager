from fastapi import APIRouter

from app.routers.projects import (
    comments,
    conditions,
    exports,
    layers,
    lifecycle,
    projects,
)

router = APIRouter(prefix="/api")

router.include_router(projects.router)
router.include_router(conditions.router)
router.include_router(layers.router)
router.include_router(lifecycle.router)
router.include_router(comments.router)
router.include_router(exports.router)
