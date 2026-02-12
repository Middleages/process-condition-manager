from pydantic import BaseModel
from typing import Any


class LayerResponse(BaseModel):
    id: int
    layer_name: str
    step_seq: str
    layer_number: str
    sort_order: int

    model_config = {"from_attributes": True}


class ProductLayerResponse(BaseModel):
    id: int
    product_id: int
    layer_id: int
    layer: LayerResponse
    conditions: dict[str, Any]

    model_config = {"from_attributes": True}


class ProductResponse(BaseModel):
    id: int
    product_name: str
    description: str | None = None
    is_backbone: bool
    line_id: int | None = None
    part_id: str | None = None

    model_config = {"from_attributes": True}


class ProductDetailResponse(ProductResponse):
    layers: list[ProductLayerResponse] = []
