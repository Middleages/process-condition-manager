from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies.auth import get_current_user
from app.models import Product, ProductLayer
from app.models.product import Layer
from app.models.user import User
from app.repositories.backbone_repository import BackboneRepository
from app.schemas.product import ProductResponse, ProductLayerResponse, LayerResponse

router = APIRouter(prefix="/api/products", tags=["products"])


# ---------------------------------------------------------------------------
# Additional response schemas for backbone endpoints
# ---------------------------------------------------------------------------

class BackboneProductResponse(BaseModel):
    """Product info enriched with revision and approval data from its Approved project."""
    id: int
    product_name: str
    description: str | None = None
    line_id: int | None = None
    part_id: str | None = None
    revision: int
    approved_at: datetime | None = None

    model_config = {"from_attributes": True}


class BackboneLayerResponse(BaseModel):
    """Project layer from the Approved project, used as backbone layer reference."""
    id: int
    project_id: int
    layer_id: str
    layer_name: str
    step_seq: str
    conditions: dict
    backbone_conditions: dict
    sort_order: int

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Endpoints (static/prefixed routes MUST come before /{product_id} routes)
# ---------------------------------------------------------------------------

@router.get("", response_model=list[ProductResponse])
async def list_products(
    line_id: int | None = None,
    search: str | None = None,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Product).order_by(Product.product_name)
    if line_id is not None:
        query = query.where(Product.line_id == line_id)
    if search:
        query = query.where(Product.product_name.ilike(f"%{search}%"))
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/layers/all", response_model=list[LayerResponse])
async def list_all_layers(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all available layers (master data)."""
    result = await db.execute(select(Layer).order_by(Layer.sort_order))
    return result.scalars().all()


@router.get("/backbones", response_model=list[BackboneProductResponse])
async def list_backbone_products(
    line_id: int | None = None,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all products that have an Approved project (usable as backbone).

    Returns product information enriched with the revision number and
    approval timestamp from the Approved project.

    This is the canonical endpoint for backbone selection in the project
    creation workflow. Backbone eligibility is determined dynamically.
    """
    products = await BackboneRepository.list_backbone_products(db, line_id=line_id)
    return products


@router.get("/{product_id}/backbone-layers", response_model=list[BackboneLayerResponse])
async def get_backbone_layers(
    product_id: int,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the Approved project's layers for a product (backbone layer reference).

    Used when selecting which layers to copy when creating a new project
    or replacing a layer backbone. Returns the project_layers from the
    product's Approved project.
    """
    layers = await BackboneRepository.get_backbone_layers(db, product_id)
    if not layers:
        # Verify the product exists to give a proper 404 vs empty list
        product = await db.get(Product, product_id)
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
    return layers


@router.get("/{product_id}/layers", response_model=list[ProductLayerResponse])
async def get_product_layers(
    product_id: int,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    result = await db.execute(
        select(ProductLayer)
        .options(selectinload(ProductLayer.layer))
        .where(ProductLayer.product_id == product_id)
    )
    layers = result.scalars().all()
    # Sort by layer sort_order
    layers.sort(key=lambda pl: pl.layer.sort_order)
    return layers
