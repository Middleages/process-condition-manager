from fastapi import APIRouter

from app.routers import (
    admin,
    admin_announcements,
    admin_device,
    admin_master,
    admin_users,
    export_admin,
    export_data_source,
)

router = APIRouter(prefix="/api/admin")

router.include_router(admin.router)
router.include_router(admin_users.router)
router.include_router(admin_master.router)
router.include_router(admin_device.router)
router.include_router(admin_announcements.router)
router.include_router(export_admin.router)
router.include_router(export_data_source.router)
