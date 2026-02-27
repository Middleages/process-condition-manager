"""Public device-masters API 라우터.

인증된 사용자가 디바이스/레이어 마스터 데이터를 조회할 수 있는 공개 API.
RBAC: require_active_user (모든 인증된 활성 사용자)
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import Float, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_active_user
from app.models.device_master import DeviceMaster, LayerMaster
from app.models.line import Line
from app.models.project import Project
from app.models.user import User
from app.schemas.device_master import (
    DeviceMasterListResponse,
    DeviceMasterResponse,
    DeviceLayerItem,
    DeviceSearchResult,
    DuplicateCheckResponse,
    LayerMasterResponse,
)
from app.services import device_master_query_service

router = APIRouter(prefix="/api/device-masters", tags=["device-masters"])


def _build_device_response(device: DeviceMaster, line_name: str) -> DeviceMasterResponse:
    """ORM 인스턴스 + line_name을 응답 스키마로 변환한다."""
    return DeviceMasterResponse(
        id=device.id,
        line_id=device.line_id,
        line_name=line_name,
        product_name=device.product_name,
        process=device.process,
        part_id=device.part_id,
        is_active=device.is_active,
        enrichment=device.enrichment or {},
        synced_at=device.synced_at,
        created_at=device.created_at,
        updated_at=device.updated_at,
    )


# ---------------------------------------------------------------------------
# SPEC-PROJECT-002: Search / Layer / Duplicate-check endpoints
# ---------------------------------------------------------------------------


@router.get("/search", response_model=list[DeviceSearchResult])
async def search_devices(
    q: str = Query(..., min_length=1, description="검색 키워드 (product_name / process / part_id ILIKE)"),
    line_id: int | None = Query(None, description="Line ID 필터"),
    _user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[DeviceSearchResult]:
    """Search device masters by keyword for autocomplete.

    Searches product_name, process, and part_id fields using ILIKE.
    """
    devices = await device_master_query_service.search_devices(
        db, line_id=line_id, product_name=q,
    )
    return [DeviceSearchResult.model_validate(d) for d in devices]


@router.post("/check-duplicate", response_model=DuplicateCheckResponse)
async def check_duplicate(
    line_id: int = Body(...),
    product_name: str = Body(...),
    process: str = Body(...),
    part_id: str = Body(...),
    _user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
) -> DuplicateCheckResponse:
    """Check if a project already exists for the given device reference.

    Finds matching device_master by (line_id, product_name, process, part_id),
    then checks if any Project with that device_master_id has status in ('draft', 'review').
    """
    device = await device_master_query_service.get_device_by_ref(
        db, line_id, product_name, process, part_id,
    )
    if device is None:
        return DuplicateCheckResponse(exists=False)

    result = await db.execute(
        select(Project)
        .where(
            Project.device_master_id == device.id,
            Project.status.in_(("draft", "review")),
        )
        .order_by(Project.created_at.desc())
        .limit(1)
    )
    existing = result.scalars().first()
    if existing is None:
        return DuplicateCheckResponse(exists=False)

    return DuplicateCheckResponse(
        exists=True,
        existing_project_id=existing.id,
        existing_project_status=existing.status,
        existing_project_revision=existing.revision,
    )


@router.get("/{device_master_id}/layers", response_model=list[DeviceLayerItem])
async def get_device_layers(
    device_master_id: int,
    _user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[DeviceLayerItem]:
    """Get layers for a specific device master via query service.

    Uses device_master_query_service for consistent layer retrieval.
    """
    device = await db.get(DeviceMaster, device_master_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device master not found")

    layers = await device_master_query_service.get_device_layers(db, device_master_id)
    return [DeviceLayerItem.model_validate(layer) for layer in layers]


# ---------------------------------------------------------------------------
# Original CRUD endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=DeviceMasterListResponse)
async def list_device_masters(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    line_id: int | None = Query(None, description="Line ID 필터"),
    product_name: str | None = Query(None, description="제품명 부분 일치 검색"),
    process: str | None = Query(None, description="공정 타입 필터"),
    _user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceMasterListResponse:
    """디바이스 마스터 목록 페이지네이션 조회.

    - line_id: 특정 라인 필터
    - product_name: ILIKE 부분 일치 검색
    - process: 공정 타입 필터
    """
    base_query = select(DeviceMaster, Line.line_name).join(
        Line, DeviceMaster.line_id == Line.id,
    )
    count_query = select(func.count(DeviceMaster.id))

    # 필터 적용
    if line_id is not None:
        base_query = base_query.where(DeviceMaster.line_id == line_id)
        count_query = count_query.where(DeviceMaster.line_id == line_id)
    if product_name is not None:
        pattern = f"%{product_name}%"
        base_query = base_query.where(DeviceMaster.product_name.ilike(pattern))
        count_query = count_query.where(DeviceMaster.product_name.ilike(pattern))
    if process is not None:
        base_query = base_query.where(DeviceMaster.process == process)
        count_query = count_query.where(DeviceMaster.process == process)

    # 총 건수
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # 페이지네이션
    offset = (page - 1) * size
    data_query = (
        base_query
        .order_by(DeviceMaster.line_id, DeviceMaster.product_name)
        .offset(offset)
        .limit(size)
    )
    result = await db.execute(data_query)
    rows = result.all()

    items = [_build_device_response(device, line_name) for device, line_name in rows]

    return DeviceMasterListResponse(items=items, total=total, page=page, size=size)


@router.get("/{device_id}", response_model=DeviceMasterResponse)
async def get_device_master(
    device_id: int,
    _user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceMasterResponse:
    """디바이스 마스터 단건 조회.

    Raises:
        HTTPException 404: 디바이스 미발견.
    """
    result = await db.execute(
        select(DeviceMaster, Line.line_name)
        .join(Line, DeviceMaster.line_id == Line.id)
        .where(DeviceMaster.id == device_id)
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=404, detail="Device master not found")

    device, line_name = row
    return _build_device_response(device, line_name)



# NOTE: /{device_id}/layers is now handled by get_device_layers above (SPEC-PROJECT-002).
