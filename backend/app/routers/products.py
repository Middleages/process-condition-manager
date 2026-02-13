from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Product, ProductLayer
from app.models.product import Layer
from app.schemas.product import ProductResponse, ProductLayerResponse, LayerResponse

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("", response_model=list[ProductResponse])
async def list_products(
    line_id: int | None = None,
    is_backbone: bool | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Product).order_by(Product.product_name)
    if line_id is not None:
        query = query.where(Product.line_id == line_id)
    if is_backbone is not None:
        query = query.where(Product.is_backbone == is_backbone)
    if search:
        query = query.where(Product.product_name.ilike(f"%{search}%"))
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/layers/all", response_model=list[LayerResponse])
async def list_all_layers(db: AsyncSession = Depends(get_db)):
    """Return all available layers (master data)."""
    result = await db.execute(select(Layer).order_by(Layer.sort_order))
    return result.scalars().all()


@router.get("/{product_id}/layers", response_model=list[ProductLayerResponse])
async def get_product_layers(
    product_id: int,
    db: AsyncSession = Depends(get_db),
):
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "Product not found")

    result = await db.execute(
        select(ProductLayer)
        .options(selectinload(ProductLayer.layer))
        .where(ProductLayer.product_id == product_id)
    )
    layers = result.scalars().all()
    # Sort by layer sort_order
    layers.sort(key=lambda pl: pl.layer.sort_order)
    return layers
