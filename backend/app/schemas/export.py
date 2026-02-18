from typing import Any

from pydantic import BaseModel


class ExportRequest(BaseModel):
    system_ids: list[int]


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
