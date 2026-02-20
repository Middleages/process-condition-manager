"""Admin router for master data management (Lines, Products, Layers, Columns, Categories)."""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.dependencies.auth import require_admin
from app.schemas.admin_master import (
    LineCreate, LineUpdate, LineResponse,
    ProductCreate, ProductUpdate, ProductResponse,
    LayerCreate, LayerUpdate, LayerResponse, LayerReorderRequest,
    ColumnMetadataUpdate, ColumnMetadataResponse,
    CategoryUpdate, CategoryResponse, CategoryReorderRequest,
)
from app.services import admin_master_service

router = APIRouter(prefix="/api/admin", tags=["admin-master"])


# ---------------------------------------------------------------------------
# Lines
# ---------------------------------------------------------------------------

@router.get("/lines", response_model=list[LineResponse])
async def list_lines(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all lines with product counts (admin only)."""
    return await admin_master_service.list_lines(db)


@router.post("/lines", response_model=LineResponse, status_code=201)
async def create_line(
    data: LineCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Create a new line (admin only)."""
    return await admin_master_service.create_line(db, data)


@router.put("/lines/{line_id}", response_model=LineResponse)
async def update_line(
    line_id: int,
    data: LineUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update a line (admin only)."""
    return await admin_master_service.update_line(db, line_id, data)


@router.delete("/lines/{line_id}", status_code=204)
async def delete_line(
    line_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Delete a line (admin only)."""
    await admin_master_service.delete_line(db, line_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

@router.get("/products", response_model=list[ProductResponse])
async def list_products(
    line_id: int | None = Query(None, description="Filter by line ID"),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all products with line info (admin only)."""
    return await admin_master_service.list_products(db, line_id=line_id)


@router.post("/products", response_model=ProductResponse, status_code=201)
async def create_product(
    data: ProductCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Create a new product (admin only)."""
    return await admin_master_service.create_product(db, data)


@router.put("/products/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int,
    data: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update a product (admin only)."""
    return await admin_master_service.update_product(db, product_id, data)


@router.delete("/products/{product_id}", status_code=204)
async def delete_product(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Delete a product (admin only)."""
    await admin_master_service.delete_product(db, product_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Layers
# (reorder endpoint MUST be before /{layer_id} to avoid path conflict)
# ---------------------------------------------------------------------------

@router.get("/layers", response_model=list[LayerResponse])
async def list_layers(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all layers ordered by sort_order (admin only)."""
    return await admin_master_service.list_layers(db)


@router.post("/layers", response_model=LayerResponse, status_code=201)
async def create_layer(
    data: LayerCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Create a new layer (admin only)."""
    return await admin_master_service.create_layer(db, data)


@router.put("/layers/reorder", response_model=list[LayerResponse])
async def reorder_layers(
    data: LayerReorderRequest,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Reorder layers by providing ordered list of IDs (admin only)."""
    return await admin_master_service.reorder_layers(db, data)


@router.put("/layers/{layer_id}", response_model=LayerResponse)
async def update_layer(
    layer_id: int,
    data: LayerUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update a layer (admin only)."""
    return await admin_master_service.update_layer(db, layer_id, data)


@router.delete("/layers/{layer_id}", status_code=204)
async def delete_layer(
    layer_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Delete a layer (admin only)."""
    await admin_master_service.delete_layer(db, layer_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Columns (metadata only)
# ---------------------------------------------------------------------------

@router.put("/columns/{column_id}/metadata", response_model=ColumnMetadataResponse)
async def update_column_metadata(
    column_id: int,
    data: ColumnMetadataUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update column metadata (display_name, unit, is_required) (admin only)."""
    return await admin_master_service.update_column_metadata(db, column_id, data)


# ---------------------------------------------------------------------------
# Categories
# (reorder endpoint MUST be before /{category_id} to avoid path conflict)
# ---------------------------------------------------------------------------

@router.get("/categories", response_model=list[CategoryResponse])
async def list_categories(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all categories ordered by sort_order with column counts (admin only)."""
    return await admin_master_service.list_categories(db)


@router.put("/categories/reorder", response_model=list[CategoryResponse])
async def reorder_categories(
    data: CategoryReorderRequest,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Reorder categories by providing ordered list of IDs (admin only)."""
    return await admin_master_service.reorder_categories(db, data)


@router.put("/categories/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int,
    data: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update a category name (admin only)."""
    return await admin_master_service.update_category(db, category_id, data)
