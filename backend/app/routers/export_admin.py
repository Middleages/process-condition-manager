"""Admin 전산 출력 시스템/매핑 CRUD 라우터.

RBAC 분리:
- GET 엔드포인트: admin 또는 developer (require_admin_or_developer)
- 쓰기 엔드포인트: developer (require_system_write)
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_admin_or_developer, require_system_write
from app.models.user import User
from app.services.export_admin_service import ExportAdminService
from app.schemas.export_admin import (
    ExportSystemCreate,
    ExportSystemUpdate,
    ExportSystemAdminResponse,
    ExportMappingCreate,
    ExportMappingUpdate,
    ExportMappingResponse,
    MappingReorderRequest,
)

router = APIRouter(prefix="/api/admin", tags=["export-admin"])


# ---------------------------------------------------------------------------
# ExportSystem 엔드포인트
# ---------------------------------------------------------------------------

@router.get("/export-systems", response_model=list[ExportSystemAdminResponse])
async def list_export_systems(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """전체 출력 시스템 목록 조회 (admin/developer)."""
    return await ExportAdminService.list_systems(db)


@router.post("/export-systems", response_model=ExportSystemAdminResponse, status_code=201)
async def create_export_system(
    data: ExportSystemCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """출력 시스템 생성 (developer only). system_name 중복 시 409."""
    return await ExportAdminService.create_system(db, data)


@router.put("/export-systems/{system_id}", response_model=ExportSystemAdminResponse)
async def update_export_system(
    system_id: int,
    data: ExportSystemUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """출력 시스템 수정 (developer only). 404: 미발견, 409: 이름 충돌."""
    return await ExportAdminService.update_system(db, system_id, data)


@router.delete("/export-systems/{system_id}", status_code=204, response_model=None)
async def delete_export_system(
    system_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """출력 시스템 삭제 (developer only). CASCADE로 연관 매핑도 삭제."""
    await ExportAdminService.delete_system(db, system_id)


# ---------------------------------------------------------------------------
# ExportColumnMapping 엔드포인트
# ---------------------------------------------------------------------------

@router.get(
    "/export-systems/{system_id}/mappings",
    response_model=list[ExportMappingResponse],
)
async def list_export_mappings(
    system_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """출력 시스템 컬럼 매핑 목록 조회 (admin/developer)."""
    return await ExportAdminService.list_mappings(db, system_id)


@router.post(
    "/export-systems/{system_id}/mappings",
    response_model=ExportMappingResponse,
    status_code=201,
)
async def create_export_mapping(
    system_id: int,
    data: ExportMappingCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """출력 시스템 컬럼 매핑 생성 (developer only). sort_order 자동 할당."""
    return await ExportAdminService.create_mapping(db, system_id, data)


@router.put(
    "/export-systems/{system_id}/mappings/{mapping_id}",
    response_model=ExportMappingResponse,
)
async def update_export_mapping(
    system_id: int,
    mapping_id: int,
    data: ExportMappingUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """출력 시스템 컬럼 매핑 수정 (developer only). 404: 시스템/매핑 미발견."""
    return await ExportAdminService.update_mapping(db, system_id, mapping_id, data)


@router.delete(
    "/export-systems/{system_id}/mappings/{mapping_id}",
    status_code=204,
    response_model=None,
)
async def delete_export_mapping(
    system_id: int,
    mapping_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """출력 시스템 컬럼 매핑 삭제 (developer only). 404: 시스템/매핑 미발견."""
    await ExportAdminService.delete_mapping(db, system_id, mapping_id)


@router.put(
    "/export-systems/{system_id}/mappings/reorder",
    response_model=list[ExportMappingResponse],
)
async def reorder_export_mappings(
    system_id: int,
    data: MappingReorderRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """출력 시스템 컬럼 매핑 순서 변경 (developer only)."""
    return await ExportAdminService.reorder_mappings(db, system_id, data.ordered_ids)
