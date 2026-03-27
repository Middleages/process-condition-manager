from fastapi import APIRouter

from app.routers import (
    announcements,
    columns,
    config_change,
    dashboard,
    device_masters,
    equipments,
    export,
    lines,
    products,
    uploads,
    users,
)

router = APIRouter(prefix="/api")

router.include_router(users.router)
router.include_router(lines.router)
router.include_router(columns.router)
router.include_router(products.router)
router.include_router(equipments.router)
router.include_router(dashboard.router)
router.include_router(device_masters.router)
router.include_router(announcements.router)
router.include_router(config_change.router)
router.include_router(uploads.router)
router.include_router(export.router)
