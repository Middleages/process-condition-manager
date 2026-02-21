"""Pydantic schemas for ExportDataSource CRUD operations."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, field_validator


# ---------------------------------------------------------------------------
# Allowed PCM join field values
# ---------------------------------------------------------------------------

PCM_FIELD_CHOICES = Literal[
    "project.product_id",
    "layer.step_seq",
    "layer.layer_name",
    "layer.layer_number",
]


# ---------------------------------------------------------------------------
# JoinKeyMapping sub-schema
# ---------------------------------------------------------------------------


class JoinKeyMapping(BaseModel):
    """Maps an external table column to a PCM domain field."""

    external_column: str
    pcm_field: PCM_FIELD_CHOICES

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# ExportDataSource CRUD Schemas
# ---------------------------------------------------------------------------


class ExportDataSourceCreate(BaseModel):
    """Schema for creating a new external data source registration."""

    source_name: str
    table_name: str
    schema_name: str = "public"
    description: Optional[str] = None
    join_key_mappings: list[JoinKeyMapping]
    is_active: bool = True

    @field_validator("source_name")
    @classmethod
    def source_name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("source_name must not be empty")
        return v

    @field_validator("table_name")
    @classmethod
    def table_name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("table_name must not be empty")
        return v


class ExportDataSourceUpdate(BaseModel):
    """Schema for partial update of an external data source registration."""

    source_name: Optional[str] = None
    table_name: Optional[str] = None
    schema_name: Optional[str] = None
    description: Optional[str] = None
    join_key_mappings: Optional[list[JoinKeyMapping]] = None
    is_active: Optional[bool] = None


class ExportDataSourceResponse(BaseModel):
    """Response schema for an external data source."""

    id: int
    source_name: str
    table_name: str
    schema_name: str
    description: Optional[str]
    join_key_mappings: list[JoinKeyMapping]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    mapping_count: int  # computed: len(join_key_mappings)

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Column discovery response schema
# ---------------------------------------------------------------------------


class ColumnInfo(BaseModel):
    """Describes a single column discovered from an external table."""

    column_name: str
    data_type: str
