from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ExportRequest(BaseModel):
    system_ids: list[int]


class ExportValidationIssue(BaseModel):
    level: str  # "error" or "warning"
    layer_name: str
    column_name: str
    message: str


class ExportValidationSystemResult(BaseModel):
    system_id: int
    system_name: str
    error_count: int
    warning_count: int
    issues: list[ExportValidationIssue]


class ExportValidationRequest(BaseModel):
    system_ids: list[int]


class ExportValidationResponse(BaseModel):
    results: list[ExportValidationSystemResult]
    has_errors: bool  # True if any system has errors
    total_errors: int
    total_warnings: int


class ExportSystemResponse(BaseModel):
    id: int
    system_name: str
    format_type: str
    description: str | None
    column_count: int
    is_active: bool

    model_config = {"from_attributes": True}


class ExportPreviewResponse(BaseModel):
    system_name: str
    format_type: str
    headers: list[str]
    rows: list[dict[str, Any]]
    total_rows: int


class ExportHistoryResponse(BaseModel):
    id: int
    project_id: int
    export_system_id: int
    system_name: str          # from joined ExportSystem
    exported_by: int
    exported_by_name: str     # from joined User
    export_type: str          # 'single' or 'bulk'
    file_count: int
    total_rows: int
    exported_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ExportHistoryListResponse(BaseModel):
    items: list[ExportHistoryResponse]
    total: int
