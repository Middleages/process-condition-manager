"""Admin router for XML mappings and validation rules management."""

from datetime import datetime
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
    ColumnSelectOptionsResponse,
    SelectOptionsUpdate,
    AuditLogListResponse,
)
from app.schemas.column import ColumnCategoryResponse
from app.schemas.export import ExportHistoryListResponse
from app.services import admin_service
from app.services.export_history_service import ExportHistoryService

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


# ---------------------------------------------------------------------------
# Select Options endpoints
# (Must appear before /columns/{column_id}/validations to avoid path conflict)
# ---------------------------------------------------------------------------

@router.get("/columns/select-options", response_model=list[ColumnSelectOptionsResponse])
async def list_select_columns(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List columns with data_type='select' and their options."""
    return await admin_service.list_select_columns(db)


@router.put("/columns/{column_id}/select-options", response_model=ColumnSelectOptionsResponse)
async def update_select_options(
    column_id: int,
    data: SelectOptionsUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update select_options for a specific column."""
    return await admin_service.update_select_options(db, column_id, data)


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


# ---------------------------------------------------------------------------
# Export History endpoints
# ---------------------------------------------------------------------------

@router.get("/export-history", response_model=ExportHistoryListResponse)
async def get_all_export_history(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Return paginated export history across all projects (admin only)."""
    items, total = await ExportHistoryService.get_all_history(
        db, offset=offset, limit=limit
    )
    return ExportHistoryListResponse(items=items, total=total)


# ---------------------------------------------------------------------------
# Audit Log endpoints
# ---------------------------------------------------------------------------

@router.get("/audit-logs", response_model=AuditLogListResponse)
async def list_audit_logs(
    project_id: int | None = Query(None),
    changed_by: int | None = Query(None),
    change_type: str | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List change audit logs with optional filters (admin only)."""
    items, total = await admin_service.list_audit_logs(
        db,
        project_id=project_id,
        changed_by=changed_by,
        change_type=change_type,
        date_from=date_from,
        date_to=date_to,
        offset=offset,
        limit=limit,
    )
    return AuditLogListResponse(items=items, total=total)
