"""Admin device/layer/sync/enrichment API 라우터.

RBAC 분리:
- GET (조회): admin 또는 developer (require_admin_or_developer)
- POST/PUT/DELETE (변경): developer (require_system_write)
- Sync/Enrich: admin 또는 developer (require_admin_or_developer)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_admin_or_developer, require_system_write
from app.models.user import User
from app.schemas.device_master import (
    ColumnInfo,
    DeviceMetaSourceCreate,
    DeviceMetaSourceResponse,
    DeviceMetaSourceUpdate,
    DeviceSyncResult,
    EnrichmentResult,
    EnrichmentSummary,
    SyncSourceConfigCreate,
    SyncSourceConfigResponse,
    SyncSourceConfigUpdate,
)
from app.services.device.enrichment_service import DeviceEnrichmentService
from app.services.device.sync_service import DeviceMasterSyncService
from app.services.device.meta_source_service import DeviceMetaSourceService
from app.services.sync_source_config_service import SyncSourceConfigService

router = APIRouter(tags=["admin-device"])

# ======================================================================
# Device / Layer Sync
# ======================================================================


@router.post(
    "/device-masters/sync",
    response_model=DeviceSyncResult,
    summary="디바이스 마스터 동기화",
)
async def sync_device_masters(
    auto_enrich: bool = Query(True, description="동기화 후 자동 enrichment 실행 여부"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
) -> DeviceSyncResult:
    """외부 소스 테이블에서 device_master를 동기화한다.

    auto_enrich=true 시 동기화 후 자동으로 전체 enrichment를 수행한다.
    """
    return await DeviceMasterSyncService.sync_devices(db, auto_enrich=auto_enrich)


@router.post(
    "/layer-masters/sync",
    response_model=DeviceSyncResult,
    summary="레이어 마스터 동기화",
)
async def sync_layer_masters(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
) -> DeviceSyncResult:
    """외부 소스 테이블에서 layer_master를 동기화한다.

    device_master가 먼저 동기화되어 있어야 한다.
    """
    return await DeviceMasterSyncService.sync_layers(db)


# ======================================================================
# Device Enrichment
# ======================================================================


@router.post(
    "/device-masters/{device_id}/enrich",
    response_model=EnrichmentResult,
    summary="단일 디바이스 enrichment",
)
async def enrich_device(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
) -> EnrichmentResult:
    """단일 디바이스에 대해 모든 활성 메타 소스로부터 enrichment를 수행한다."""
    return await DeviceEnrichmentService.enrich_device(db, device_id)


@router.post(
    "/device-masters/enrich-all",
    response_model=EnrichmentSummary,
    summary="전체 디바이스 enrichment",
)
async def enrich_all_devices(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
) -> EnrichmentSummary:
    """모든 활성 디바이스에 대해 enrichment를 수행한다."""
    return await DeviceEnrichmentService.enrich_all_devices(db)


# ======================================================================
# Sync Source Config CRUD
# ======================================================================


@router.get(
    "/sync-source-configs",
    response_model=list[SyncSourceConfigResponse],
    summary="동기화 소스 설정 목록",
)
async def list_sync_source_configs(
    source_type: str | None = Query(None, description="device 또는 layer 필터"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
) -> list[SyncSourceConfigResponse]:
    """동기화 소스 설정 목록을 조회한다."""
    return await SyncSourceConfigService.list_configs(db, source_type=source_type)


@router.post(
    "/sync-source-configs",
    response_model=SyncSourceConfigResponse,
    status_code=201,
    summary="동기화 소스 설정 생성",
)
async def create_sync_source_config(
    data: SyncSourceConfigCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
) -> SyncSourceConfigResponse:
    """동기화 소스 설정을 생성한다.

    409: (source_type, source_name) 중복, 400: 참조 테이블 미존재.
    """
    return await SyncSourceConfigService.create_config(db, data)


@router.put(
    "/sync-source-configs/{config_id}",
    response_model=SyncSourceConfigResponse,
    summary="동기화 소스 설정 수정",
)
async def update_sync_source_config(
    config_id: int,
    data: SyncSourceConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
) -> SyncSourceConfigResponse:
    """동기화 소스 설정을 수정한다.

    404: 미발견, 409: 이름 충돌, 400: 테이블 미존재.
    """
    return await SyncSourceConfigService.update_config(db, config_id, data)


@router.delete(
    "/sync-source-configs/{config_id}",
    status_code=200,
    summary="동기화 소스 설정 삭제",
)
async def delete_sync_source_config(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
) -> dict:
    """동기화 소스 설정을 삭제한다.

    404: 미발견.
    """
    return await SyncSourceConfigService.delete_config(db, config_id)


# ======================================================================
# Device Meta Source CRUD
# ======================================================================


@router.get(
    "/device-meta-sources",
    response_model=list[DeviceMetaSourceResponse],
    summary="디바이스 메타 소스 목록",
)
async def list_device_meta_sources(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
) -> list[DeviceMetaSourceResponse]:
    """디바이스 enrichment 메타 소스 목록을 조회한다."""
    return await DeviceMetaSourceService.list_sources(db)


@router.post(
    "/device-meta-sources",
    response_model=DeviceMetaSourceResponse,
    status_code=201,
    summary="디바이스 메타 소스 생성",
)
async def create_device_meta_source(
    data: DeviceMetaSourceCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
) -> DeviceMetaSourceResponse:
    """디바이스 enrichment 메타 소스를 생성한다.

    409: source_name 중복, 400: 참조 테이블 미존재.
    """
    return await DeviceMetaSourceService.create_source(db, data)


@router.put(
    "/device-meta-sources/{meta_source_id}",
    response_model=DeviceMetaSourceResponse,
    summary="디바이스 메타 소스 수정",
)
async def update_device_meta_source(
    meta_source_id: int,
    data: DeviceMetaSourceUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
) -> DeviceMetaSourceResponse:
    """디바이스 enrichment 메타 소스를 수정한다.

    404: 미발견, 409: 이름 충돌, 400: 테이블 미존재.
    """
    return await DeviceMetaSourceService.update_source(db, meta_source_id, data)


@router.delete(
    "/device-meta-sources/{meta_source_id}",
    status_code=200,
    summary="디바이스 메타 소스 삭제",
)
async def delete_device_meta_source(
    meta_source_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
) -> dict:
    """디바이스 enrichment 메타 소스를 삭제한다.

    404: 미발견.
    """
    return await DeviceMetaSourceService.delete_source(db, meta_source_id)


# ======================================================================
# Column Discovery
# ======================================================================


@router.get(
    "/device-meta-sources/discover-columns",
    response_model=list[ColumnInfo],
    summary="외부 테이블 컬럼 탐색",
)
async def discover_columns(
    table_name: str = Query(..., description="탐색할 테이블명"),
    schema_name: str = Query("public", description="스키마명"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
) -> list[ColumnInfo]:
    """information_schema에서 지정 테이블의 컬럼 목록을 조회한다.

    400: 테이블 미존재.
    """
    return await DeviceEnrichmentService.discover_columns(db, table_name, schema_name)
