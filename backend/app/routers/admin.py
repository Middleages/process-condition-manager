"""Admin router for XML mappings and validation rules management."""

from fastapi import APIRouter, Depends, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.dependencies.auth import require_admin
from app.schemas.admin import (
    RecipeMappingResponse,
    RecipeMappingCreate,
    RecipeMappingUpdate,
    ValidationRulesReplace,
    BulkUploadResponse,
)
from app.schemas.column import ColumnCategoryResponse
from app.services import admin_service

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Recipe XML Mapping endpoints
# ---------------------------------------------------------------------------

@router.get("/recipe-mappings", response_model=list[RecipeMappingResponse])
async def list_recipe_mappings(
    is_active: bool | None = Query(None, description="Filter by active status"),
    search: str | None = Query(None, description="Search in xpath, column name, or display name"),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List recipe XML mappings with optional filters."""
    return await admin_service.list_mappings(db, is_active=is_active, search=search)


@router.post("/recipe-mappings", response_model=RecipeMappingResponse, status_code=201)
async def create_recipe_mapping(
    data: RecipeMappingCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Create a new recipe XML mapping."""
    return await admin_service.create_mapping(db, data)


@router.put("/recipe-mappings/{mapping_id}", response_model=RecipeMappingResponse)
async def update_recipe_mapping(
    mapping_id: int,
    data: RecipeMappingUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update an existing recipe XML mapping."""
    return await admin_service.update_mapping(db, mapping_id, data)


@router.delete("/recipe-mappings/{mapping_id}", status_code=204)
async def delete_recipe_mapping(
    mapping_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Delete a recipe XML mapping."""
    await admin_service.delete_mapping(db, mapping_id)


# ---------------------------------------------------------------------------
# Validation Rule endpoints
# ---------------------------------------------------------------------------

@router.get("/columns", response_model=list[ColumnCategoryResponse])
async def list_columns_with_validations(
    category_code: str | None = Query(None, description="Filter by category code (SP, SC, OVL, DEV)"),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List columns grouped by category with their validation rules."""
    return await admin_service.list_columns_with_validations(db, category_code=category_code)


@router.put("/columns/{column_id}/validations", response_model=dict)
async def replace_column_validations(
    column_id: int,
    data: ValidationRulesReplace,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Replace all validation rules for a column."""
    return await admin_service.replace_validations(db, column_id, data.validations)


@router.post("/columns/validations/bulk", response_model=BulkUploadResponse)
async def bulk_upload_validations(
    file: UploadFile = File(..., description="Excel file with validation rules"),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Bulk upload validation rules from Excel file.

    Excel format:
    - Headers: column_name, rule_type, rule_config, error_message, is_active
    - rule_type: range, required, conditional_required, cross_layer
    - rule_config: JSON string (e.g., {"min": 0, "max": 100})
    - is_active: TRUE, FALSE, 1, 0, YES, NO, Y, N
    """
    contents = await file.read()
    from io import BytesIO
    return await admin_service.bulk_upload_validations(db, BytesIO(contents))
