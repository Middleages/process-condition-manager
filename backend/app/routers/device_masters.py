"""Public device-masters API 라우터.

인증된 사용자가 디바이스/레이어 마스터 데이터를 조회할 수 있는 공개 API.
RBAC: require_active_user (모든 인증된 활성 사용자)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Float, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_active_user
from app.models.device_master import DeviceMaster, LayerMaster
from app.models.line import Line
from app.models.user import User
from app.schemas.device_master import (
    DeviceMasterListResponse,
    DeviceMasterResponse,
    LayerMasterResponse,
)

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


@router.get("/{device_id}/layers", response_model=list[LayerMasterResponse])
async def list_device_layers(
    device_id: int,
    _user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[LayerMasterResponse]:
    """디바이스에 속한 레이어 마스터 목록 조회.

    layer_id를 숫자로 변환하여 정렬한다 (CAST 가능 시).

    Raises:
        HTTPException 404: 디바이스 미발견.
    """
    # 디바이스 존재 확인
    device = await db.get(DeviceMaster, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device master not found")

    # 레이어 조회 (layer_id 숫자 정렬)
    result = await db.execute(
        select(LayerMaster)
        .where(LayerMaster.device_master_id == device_id)
        .order_by(cast(LayerMaster.layer_id, Float))
    )
    layers = result.scalars().all()

    return [LayerMasterResponse.model_validate(layer) for layer in layers]
