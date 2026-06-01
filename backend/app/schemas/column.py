from pydantic import BaseModel
from typing import Any


class ColumnValidationResponse(BaseModel):
    id: int
    rule_type: str
    rule_config: dict[str, Any]
    error_message: str
    is_active: bool

    model_config = {"from_attributes": True}


class ColumnDefinitionResponse(BaseModel):
    id: int
    column_name: str
    display_name: str
    category_id: int
    data_type: str
    select_options: list[Any] | None = None
    unit: str | None = None
    sort_order: int
    is_required: bool
    use_yn: bool
    validations: list[ColumnValidationResponse] = []

    model_config = {"from_attributes": True}


class ColumnCategoryResponse(BaseModel):
    id: int
    category_code: str
    category_name: str
    sort_order: int
    columns: list[ColumnDefinitionResponse] = []

    model_config = {"from_attributes": True}
