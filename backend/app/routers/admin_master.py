"""Admin 마스터 데이터 관리 라우터 (Lines, Products, Layers, Columns, Categories, Equipments).

RBAC 분리:
- GET 엔드포인트: admin 또는 developer 역할 (require_admin_or_developer)
- Lines/Products/Layers/Equipment 쓰기: admin 역할 (require_ops_write)
- Columns/Categories 쓰기: developer 역할 (require_system_write)
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.dependencies.auth import require_admin_or_developer, require_ops_write, require_system_write
from app.schemas.admin_master import (
    LineCreate, LineUpdate, LineResponse,
    ProductCreate, ProductUpdate, ProductResponse,
    LayerCreate, LayerUpdate, LayerResponse, LayerReorderRequest,
    ColumnMetadataUpdate, ColumnMetadataResponse, ColumnCreateRequest,
    CategoryCreateRequest, CategoryUpdate, CategoryResponse, CategoryReorderRequest,
    EquipmentCreate, EquipmentUpdate, EquipmentResponse, EquipmentReorderRequest,
)
from app.services import admin_master_service

router = APIRouter(tags=["admin-master"])


# ---------------------------------------------------------------------------
# Lines
# ---------------------------------------------------------------------------

@router.get("/lines", response_model=list[LineResponse])
async def list_lines(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """라인 목록 조회 (admin/developer)."""
    return await admin_master_service.list_lines(db)


@router.post("/lines", response_model=LineResponse, status_code=201)
async def create_line(
    data: LineCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """라인 생성 (admin only)."""
    return await admin_master_service.create_line(db, data)


@router.put("/lines/{line_id}", response_model=LineResponse)
async def update_line(
    line_id: int,
    data: LineUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """라인 수정 (admin only)."""
    return await admin_master_service.update_line(db, line_id, data)


@router.delete("/lines/{line_id}", status_code=204)
async def delete_line(
    line_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """라인 삭제 (admin only)."""
    await admin_master_service.delete_line(db, line_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

@router.get("/products", response_model=list[ProductResponse])
async def list_products(
    line_id: int | None = Query(None, description="Filter by line ID"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """제품 목록 조회 (admin/developer)."""
    return await admin_master_service.list_products(db, line_id=line_id)


@router.post("/products", response_model=ProductResponse, status_code=201)
async def create_product(
    data: ProductCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """제품 생성 (admin only)."""
    return await admin_master_service.create_product(db, data)


@router.put("/products/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int,
    data: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """제품 수정 (admin only)."""
    return await admin_master_service.update_product(db, product_id, data)


@router.delete("/products/{product_id}", status_code=204)
async def delete_product(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """제품 삭제 (admin only)."""
    await admin_master_service.delete_product(db, product_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Layers
# (reorder 엔드포인트는 /{layer_id} 앞에 위치해야 경로 충돌 방지)
# ---------------------------------------------------------------------------

@router.get("/layers", response_model=list[LayerResponse])
async def list_layers(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """레이어 목록 조회 (admin/developer)."""
    return await admin_master_service.list_layers(db)


@router.post("/layers", response_model=LayerResponse, status_code=201)
async def create_layer(
    data: LayerCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """레이어 생성 (admin only)."""
    return await admin_master_service.create_layer(db, data)


@router.put("/layers/reorder", response_model=list[LayerResponse])
async def reorder_layers(
    data: LayerReorderRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """레이어 순서 변경 (admin only)."""
    return await admin_master_service.reorder_layers(db, data)


@router.put("/layers/{layer_id}", response_model=LayerResponse)
async def update_layer(
    layer_id: int,
    data: LayerUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """레이어 수정 (admin only)."""
    return await admin_master_service.update_layer(db, layer_id, data)


@router.delete("/layers/{layer_id}", status_code=204)
async def delete_layer(
    layer_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """레이어 삭제 (admin only)."""
    await admin_master_service.delete_layer(db, layer_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Columns (시스템 설정 → developer 쓰기)
# ---------------------------------------------------------------------------

@router.post("/columns", response_model=ColumnMetadataResponse, status_code=201)
async def create_column(
    data: ColumnCreateRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """컬럼 정의 생성 (developer only)."""
    return await admin_master_service.create_column(db, data)


@router.put("/columns/{column_id}/metadata", response_model=ColumnMetadataResponse)
async def update_column_metadata(
    column_id: int,
    data: ColumnMetadataUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """컬럼 메타데이터 수정 (developer only)."""
    return await admin_master_service.update_column_metadata(db, column_id, data)


@router.delete("/columns/{column_id}", status_code=204)
async def delete_column(
    column_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """컬럼 정의 삭제 (developer only)."""
    await admin_master_service.delete_column(db, column_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Categories (시스템 설정 → developer 쓰기)
# (reorder 엔드포인트는 /{category_id} 앞에 위치해야 경로 충돌 방지)
# ---------------------------------------------------------------------------

@router.get("/categories", response_model=list[CategoryResponse])
async def list_categories(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """카테고리 목록 조회 (admin/developer)."""
    return await admin_master_service.list_categories(db)


@router.post("/categories", response_model=CategoryResponse, status_code=201)
async def create_category(
    data: CategoryCreateRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """카테고리 생성 (developer only)."""
    return await admin_master_service.create_category(db, data)


@router.put("/categories/reorder", response_model=list[CategoryResponse])
async def reorder_categories(
    data: CategoryReorderRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """카테고리 순서 변경 (developer only)."""
    return await admin_master_service.reorder_categories(db, data)


@router.put("/categories/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int,
    data: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """카테고리 수정 (developer only)."""
    return await admin_master_service.update_category(db, category_id, data)


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """카테고리 삭제 (developer only)."""
    await admin_master_service.delete_category(db, category_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Equipments (운영 데이터 → admin 쓰기)
# (reorder 엔드포인트는 /{equipment_id} 앞에 위치해야 경로 충돌 방지)
# ---------------------------------------------------------------------------

@router.get("/equipments", response_model=list[EquipmentResponse])
async def list_equipments(
    line_id: int | None = Query(None, description="Filter by line ID"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """설비 목록 조회 (admin/developer)."""
    return await admin_master_service.list_equipments(db, line_id=line_id)


@router.post("/equipments", response_model=EquipmentResponse, status_code=201)
async def create_equipment(
    data: EquipmentCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """설비 생성 (admin only)."""
    return await admin_master_service.create_equipment(db, data)


@router.put("/equipments/reorder", response_model=list[EquipmentResponse])
async def reorder_equipments(
    data: EquipmentReorderRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """설비 순서 변경 (admin only)."""
    return await admin_master_service.reorder_equipments(db, data)


@router.put("/equipments/{equipment_id}", response_model=EquipmentResponse)
async def update_equipment(
    equipment_id: int,
    data: EquipmentUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """설비 수정 (admin only)."""
    return await admin_master_service.update_equipment(db, equipment_id, data)


@router.delete("/equipments/{equipment_id}", status_code=204)
async def delete_equipment(
    equipment_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """설비 비활성화 (admin only)."""
    await admin_master_service.delete_equipment(db, equipment_id)
    return Response(status_code=204)
