from datetime import datetime
from typing import Any

from pydantic import BaseModel


class RecipeDiffItem(BaseModel):
    column_name: str
    display_name: str
    current_value: Any | None = None
    recipe_value: Any
    is_different: bool
    category_code: str | None = None


class RecipeParseWarning(BaseModel):
    xpath: str
    message: str


class RecipeDiffResult(BaseModel):
    project_layer_id: int | None = None
    layer_name: str | None = None
    detected_layer_key: str | None = None  # PID or filename-based key
    total_mapped: int
    diff_count: int
    unmapped_xpaths: list[str] = []
    warnings: list[RecipeParseWarning] = []
    items: list[RecipeDiffItem] = []


class RecipeUploadResponse(BaseModel):
    results: list[RecipeDiffResult]


class RecipeApplyItem(BaseModel):
    project_layer_id: int
    column_name: str
    new_value: Any


class RecipeApplyRequest(BaseModel):
    changes: list[RecipeApplyItem]
    applied_by: int


class RecipeApplyResponse(BaseModel):
    applied_count: int
    change_log_count: int
    updated_at: datetime
