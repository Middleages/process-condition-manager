from fastapi import APIRouter

from app.routers.admin import (
    announcements,
    data_sources,
    devices,
    export_systems,
    masters,
    settings,
    users,
)

router = APIRouter(prefix="/api/admin")

router.include_router(settings.router)
router.include_router(users.router)
router.include_router(masters.router)
router.include_router(devices.router)
router.include_router(announcements.router)
router.include_router(export_systems.router)
router.include_router(data_sources.router)
