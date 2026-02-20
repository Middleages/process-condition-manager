"""Admin Master Data management schemas."""
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


# ---------------------------------------------------------------------------
# Lines
# ---------------------------------------------------------------------------

class LineCreate(BaseModel):
    line_code: str = Field(..., max_length=50)
    line_name: str = Field(..., max_length=100)


class LineUpdate(BaseModel):
    line_code: str | None = Field(None, max_length=50)
    line_name: str | None = Field(None, max_length=100)


class LineResponse(BaseModel):
    id: int
    line_code: str
    line_name: str
    created_at: datetime
    product_count: int = 0

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

class ProductCreate(BaseModel):
    product_name: str = Field(..., max_length=100)
    description: str | None = None
    is_backbone: bool = False
    line_id: int | None = None
    part_id: str | None = Field(None, max_length=100)


class ProductUpdate(BaseModel):
    product_name: str | None = Field(None, max_length=100)
    description: str | None = None
    is_backbone: bool | None = None
    line_id: int | None = None
    part_id: str | None = None


class ProductResponse(BaseModel):
    id: int
    product_name: str
    description: str | None = None
    is_backbone: bool
    line_id: int | None = None
    line_name: str | None = None
    part_id: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Layers
# ---------------------------------------------------------------------------

class LayerCreate(BaseModel):
    layer_name: str = Field(..., max_length=100)
    step_seq: str = Field(..., max_length=10)
    layer_number: str = Field(..., max_length=10)
    sort_order: int = 0


class LayerUpdate(BaseModel):
    layer_name: str | None = Field(None, max_length=100)
    step_seq: str | None = Field(None, max_length=10)
    layer_number: str | None = Field(None, max_length=10)
    sort_order: int | None = None


class LayerResponse(BaseModel):
    id: int
    layer_name: str
    step_seq: str
    layer_number: str
    sort_order: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LayerReorderRequest(BaseModel):
    ordered_ids: list[int]


# ---------------------------------------------------------------------------
# Column metadata
# ---------------------------------------------------------------------------

class ColumnMetadataUpdate(BaseModel):
    display_name: str | None = Field(None, max_length=200)
    unit: str | None = None
    is_required: bool | None = None


class ColumnMetadataResponse(BaseModel):
    id: int
    column_name: str
    display_name: str
    category_code: str | None = None
    data_type: str
    unit: str | None = None
    is_required: bool
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Category
# ---------------------------------------------------------------------------

class CategoryUpdate(BaseModel):
    category_name: str | None = Field(None, max_length=50)


class CategoryResponse(BaseModel):
    id: int
    category_code: str
    category_name: str
    sort_order: int
    column_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class CategoryReorderRequest(BaseModel):
    ordered_ids: list[int]
