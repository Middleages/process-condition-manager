"""Admin schemas for ExportSystem and ExportColumnMapping CRUD operations."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------------------
# ExportSystem CRUD Schemas
# ---------------------------------------------------------------------------


class ExportSystemCreate(BaseModel):
    """Schema for creating a new export system."""

    system_name: str
    format_type: str  # TYPE_A / TYPE_B / TYPE_C
    description: Optional[str] = None
    additional_config: Optional[dict[str, Any]] = None
    is_active: bool = True


class ExportSystemUpdate(BaseModel):
    """Schema for partial update of an export system."""

    system_name: Optional[str] = None
    format_type: Optional[str] = None
    description: Optional[str] = None
    additional_config: Optional[dict[str, Any]] = None
    is_active: Optional[bool] = None


class ExportSystemAdminResponse(BaseModel):
    """Response schema for an export system in admin context."""

    id: int
    system_name: str
    format_type: str
    description: Optional[str]
    additional_config: Optional[dict[str, Any]]
    is_active: bool
    created_at: datetime
    column_count: int

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# ExportColumnMapping CRUD Schemas
# ---------------------------------------------------------------------------


class ExportMappingCreate(BaseModel):
    """Schema for creating a new export column mapping."""

    column_id: int
    target_column_name: str
    is_required: bool = False


class ExportMappingUpdate(BaseModel):
    """Schema for partial update of an export column mapping."""

    target_column_name: Optional[str] = None
    is_required: Optional[bool] = None


class ExportMappingResponse(BaseModel):
    """Response schema for an export column mapping."""

    id: int
    column_id: int
    column_name: str
    category_code: Optional[str]
    target_column_name: str
    sort_order: int
    is_required: bool

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Reorder Schema
# ---------------------------------------------------------------------------


class MappingReorderRequest(BaseModel):
    """Schema for reordering export column mappings."""

    ordered_ids: list[int]
