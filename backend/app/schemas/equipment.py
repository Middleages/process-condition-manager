"""Schemas for EquipmentAssignment CRUD operations."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------------------
# Equipment CRUD Schemas
# ---------------------------------------------------------------------------


class EquipmentCreate(BaseModel):
    """Schema for creating a new equipment assignment."""

    equipment_id: str
    equipment_params: dict = {}


class EquipmentUpdate(BaseModel):
    """Schema for partial update of an equipment assignment."""

    equipment_id: Optional[str] = None
    equipment_params: Optional[dict] = None


class EquipmentResponse(BaseModel):
    """Response schema for an equipment assignment."""

    id: int
    project_layer_id: int
    equipment_id: str
    equipment_params: dict
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Reorder Schema
# ---------------------------------------------------------------------------


class EquipmentReorderRequest(BaseModel):
    """Schema for reordering equipment assignments."""

    ordered_ids: list[int]
