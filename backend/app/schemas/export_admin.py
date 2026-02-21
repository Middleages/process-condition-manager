"""Admin schemas for ExportSystem and ExportColumnMapping CRUD operations."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, model_validator


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
    """Schema for creating a new export column mapping.

    For source_type='condition': column_id is required.
    For source_type='external': data_source_id and source_column_name are required.
    """

    source_type: str = "condition"
    column_id: Optional[int] = None
    data_source_id: Optional[int] = None
    source_column_name: Optional[str] = None
    target_column_name: str
    is_required: bool = False

    @model_validator(mode="after")
    def validate_source_fields(self) -> "ExportMappingCreate":
        """Validate that required fields are provided based on source_type."""
        if self.source_type == "condition":
            if self.column_id is None:
                raise ValueError("column_id is required when source_type is 'condition'")
        elif self.source_type == "external":
            if self.data_source_id is None:
                raise ValueError(
                    "data_source_id is required when source_type is 'external'"
                )
            if not self.source_column_name:
                raise ValueError(
                    "source_column_name is required when source_type is 'external'"
                )
        else:
            raise ValueError(
                f"source_type must be 'condition' or 'external', got '{self.source_type}'"
            )
        return self


class ExportMappingUpdate(BaseModel):
    """Schema for partial update of an export column mapping."""

    target_column_name: Optional[str] = None
    is_required: Optional[bool] = None
    source_type: Optional[str] = None
    data_source_id: Optional[int] = None
    source_column_name: Optional[str] = None


class ExportMappingResponse(BaseModel):
    """Response schema for an export column mapping."""

    id: int
    source_type: str
    # Condition-source fields (None for external mappings)
    column_id: Optional[int] = None
    column_name: Optional[str] = None
    category_code: Optional[str] = None
    # External-source fields (None for condition mappings)
    data_source_id: Optional[int] = None
    data_source_name: Optional[str] = None
    source_column_name: Optional[str] = None
    # Common fields
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
