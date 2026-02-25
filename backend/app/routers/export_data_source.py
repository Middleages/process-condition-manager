"""Admin 외부 데이터 소스 CRUD 및 컬럼 탐색 라우터.

RBAC 분리:
- GET + 컬럼 탐색: admin 또는 developer (require_admin_or_developer)
- POST/PUT/DELETE: developer (require_system_write)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_admin_or_developer, require_system_write
from app.models.user import User
from app.schemas.export_data_source import (
    ColumnInfo,
    ExportDataSourceCreate,
    ExportDataSourceResponse,
    ExportDataSourceUpdate,
)
from app.services.export_data_source_service import ExportDataSourceService

router = APIRouter(prefix="/api/admin", tags=["export-data-sources"])


@router.get("/data-sources", response_model=list[ExportDataSourceResponse])
async def list_data_sources(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """등록된 외부 데이터 소스 목록 조회 (admin/developer)."""
    return await ExportDataSourceService.list_sources(db)


@router.post("/data-sources", response_model=ExportDataSourceResponse, status_code=201)
async def create_data_source(
    data: ExportDataSourceCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """외부 데이터 소스 등록 (developer only).

    409: source_name 중복, 400: 테이블 미존재.
    """
    return await ExportDataSourceService.create_source(db, data)


@router.put("/data-sources/{source_id}", response_model=ExportDataSourceResponse)
async def update_data_source(
    source_id: int,
    data: ExportDataSourceUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """외부 데이터 소스 수정 (developer only).

    404: 미발견, 409: 이름 충돌, 400: 테이블 미존재.
    """
    return await ExportDataSourceService.update_source(db, source_id, data)


@router.delete("/data-sources/{source_id}", status_code=200)
async def delete_data_source(
    source_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """외부 데이터 소스 삭제 (developer only).

    매핑 참조 없으면 하드 삭제, 있으면 소프트 삭제(is_active=False).
    404: 미발견.
    """
    return await ExportDataSourceService.delete_source(db, source_id)


@router.get("/data-sources/{source_id}/columns", response_model=list[ColumnInfo])
async def discover_data_source_columns(
    source_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """외부 테이블 컬럼 탐색 (admin/developer).

    404: 데이터 소스 미발견, 400: 테이블 미존재.
    """
    return await ExportDataSourceService.discover_columns(db, source_id)
