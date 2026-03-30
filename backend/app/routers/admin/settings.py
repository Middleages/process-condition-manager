"""Admin 라우터: XML 매핑, 검증 규칙, 선택 옵션, 감사 로그, 출력 이력 관리.

RBAC 분리:
- GET 엔드포인트: admin 또는 developer (require_admin_or_developer)
- Recipe mappings 쓰기: developer (require_system_write)
- Validation rules 쓰기: developer (require_system_write)
- Select options 쓰기: admin (require_ops_write)
"""

from datetime import datetime
from fastapi import APIRouter, Depends, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.dependencies.auth import require_admin_or_developer, require_ops_write, require_system_write
from app.schemas.admin import (
    RecipeMappingResponse,
    RecipeMappingCreate,
    RecipeMappingUpdate,
    ValidationRulesReplace,
    ValidationRulesReplaceResponse,
    BulkUploadResponse,
    ColumnSelectOptionsResponse,
    SelectOptionsUpdate,
    AuditLogListResponse,
)
from app.schemas.column import ColumnCategoryResponse
from app.schemas.export import ExportHistoryListResponse
from app.services.admin import service as admin_service
from app.services.export.history_service import ExportHistoryService

router = APIRouter(tags=["admin"])


# ---------------------------------------------------------------------------
# Recipe XML Mapping 엔드포인트
# ---------------------------------------------------------------------------

@router.get("/recipe-mappings", response_model=list[RecipeMappingResponse])
async def list_recipe_mappings(
    is_active: bool | None = Query(None, description="Filter by active status"),
    search: str | None = Query(None, description="Search in xpath, column name, or display name"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """Recipe XML 매핑 목록 조회 (admin/developer)."""
    return await admin_service.list_mappings(db, is_active=is_active, search=search)


@router.post("/recipe-mappings", response_model=RecipeMappingResponse, status_code=201)
async def create_recipe_mapping(
    data: RecipeMappingCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """Recipe XML 매핑 생성 (developer only)."""
    return await admin_service.create_mapping(db, data)


@router.put("/recipe-mappings/{mapping_id}", response_model=RecipeMappingResponse)
async def update_recipe_mapping(
    mapping_id: int,
    data: RecipeMappingUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """Recipe XML 매핑 수정 (developer only)."""
    return await admin_service.update_mapping(db, mapping_id, data)


@router.delete("/recipe-mappings/{mapping_id}", status_code=204)
async def delete_recipe_mapping(
    mapping_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """Recipe XML 매핑 삭제 (developer only)."""
    await admin_service.delete_mapping(db, mapping_id)


# ---------------------------------------------------------------------------
# Validation Rule 엔드포인트
# ---------------------------------------------------------------------------

@router.get("/columns", response_model=list[ColumnCategoryResponse])
async def list_columns_with_validations(
    category_code: str | None = Query(None, description="Filter by category code (SP, SC, OVL, DEV)"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """카테고리별 컬럼 + 검증 규칙 목록 조회 (admin/developer)."""
    return await admin_service.list_columns_with_validations(db, category_code=category_code)


# ---------------------------------------------------------------------------
# Select Options 엔드포인트
# (/{column_id}/validations 앞에 위치해야 경로 충돌 방지)
# ---------------------------------------------------------------------------

@router.get("/columns/select-options", response_model=list[ColumnSelectOptionsResponse])
async def list_select_columns(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """select 타입 컬럼 + 선택 옵션 목록 조회 (admin/developer)."""
    return await admin_service.list_select_columns(db)


@router.put("/columns/{column_id}/select-options", response_model=ColumnSelectOptionsResponse)
async def update_select_options(
    column_id: int,
    data: SelectOptionsUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_ops_write),
):
    """select 옵션 수정 (admin only)."""
    return await admin_service.update_select_options(db, column_id, data)


@router.put("/columns/{column_id}/validations", response_model=ValidationRulesReplaceResponse)
async def replace_column_validations(
    column_id: int,
    data: ValidationRulesReplace,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """컬럼 검증 규칙 전체 교체 (developer only)."""
    return await admin_service.replace_validations(db, column_id, data.validations)


@router.post("/columns/validations/bulk", response_model=BulkUploadResponse)
async def bulk_upload_validations(
    file: UploadFile = File(..., description="Excel file with validation rules"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_system_write),
):
    """검증 규칙 벌크 업로드 (developer only).

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
# Export History 엔드포인트
# ---------------------------------------------------------------------------

@router.get("/export-history", response_model=ExportHistoryListResponse)
async def get_all_export_history(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """전체 프로젝트 출력 이력 조회 (admin/developer)."""
    items, total = await ExportHistoryService.list_all_history(
        db, offset=offset, limit=limit
    )
    return ExportHistoryListResponse(items=items, total=total)


# ---------------------------------------------------------------------------
# Audit Log 엔드포인트
# ---------------------------------------------------------------------------

@router.get("/audit-logs", response_model=AuditLogListResponse)
async def list_audit_logs(
    project_id: int | None = Query(None),
    line_id: int | None = Query(None),
    changed_by: int | None = Query(None),
    change_type: str | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_admin_or_developer),
):
    """변경 감사 로그 목록 조회 (admin/developer)."""
    items, total = await admin_service.list_audit_logs(
        db,
        project_id=project_id,
        line_id=line_id,
        changed_by=changed_by,
        change_type=change_type,
        date_from=date_from,
        date_to=date_to,
        offset=offset,
        limit=limit,
    )
    return AuditLogListResponse(items=items, total=total)
