"""파라미터 레지스트리 API 스키마 (Pydantic v2).

code와 value_type은 생성 후 불변이므로 Update 스키마에서 제외한다.
"""

from pydantic import BaseModel, ConfigDict, Field

from app.domain.parameters.types import ValueType


class OptionIn(BaseModel):
    """선택지 입력."""

    value: str
    display_name: str
    sort_order: int = 0


class OptionOut(BaseModel):
    """선택지 출력."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    value: str
    display_name: str
    sort_order: int
    is_active: bool


class CategoryCreate(BaseModel):
    """카테고리 생성."""

    code: str
    display_name: str
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    """카테고리 수정 (code 불변)."""

    display_name: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class CategoryOut(BaseModel):
    """카테고리 출력."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    display_name: str
    sort_order: int
    is_active: bool


class ParameterCreate(BaseModel):
    """파라미터 생성."""

    code: str
    display_name: str
    value_type: ValueType
    description: str | None = None
    category_id: int | None = None
    unit: str | None = None
    min_value: float | None = None
    max_value: float | None = None
    sort_order: int = 0
    options: list[OptionIn] = Field(default_factory=list)


class ParameterUpdate(BaseModel):
    """파라미터 수정. code와 value_type은 불변이라 제외한다."""

    display_name: str | None = None
    description: str | None = None
    category_id: int | None = None
    unit: str | None = None
    min_value: float | None = None
    max_value: float | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class ParameterOut(BaseModel):
    """파라미터 출력."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    display_name: str
    description: str | None
    value_type: ValueType
    category_id: int | None
    unit: str | None
    min_value: float | None
    max_value: float | None
    sort_order: int
    is_active: bool
    options: list[OptionOut] = Field(default_factory=list)
