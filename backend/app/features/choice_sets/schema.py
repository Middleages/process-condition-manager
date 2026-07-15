"""Exact ChoiceSet API request and response schemas."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

SetCodeText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]
OptionCodeText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]
DisplayNameText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]
LabelText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]
DescriptionText = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=512)
]


class _StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChoiceSetCreateIn(_StrictRequest):
    code: SetCodeText
    display_name: DisplayNameText
    description: DescriptionText | None = None


class ChoiceSetPatchIn(_StrictRequest):
    expected_version: int = Field(ge=1)
    display_name: DisplayNameText | None = None
    description: DescriptionText | None = None
    is_active: bool | None = None


class ChoiceOptionCreateIn(_StrictRequest):
    expected_version: int = Field(ge=1)
    code: OptionCodeText
    label: LabelText
    sort_order: int = 0
    is_active: bool = True


class ChoiceOptionPatchIn(_StrictRequest):
    expected_version: int = Field(ge=1)
    label: LabelText | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class ChoiceOptionOrderIn(_StrictRequest):
    expected_version: int = Field(ge=1)
    ordered_codes: list[OptionCodeText]


class ChoiceImportIn(_StrictRequest):
    expected_version: int = Field(ge=1)
    csv_text: str = Field(min_length=1)


class ChoiceSetSummaryOut(BaseModel):
    code: str
    display_name: str
    description: str | None
    is_active: bool
    version: int
    option_count: int
    active_option_count: int
    parameter_usage_count: int
    profile_usage_fields: list[str]
    created_at: datetime
    updated_at: datetime


class ChoiceOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    label: str
    sort_order: int
    is_active: bool


class ChoiceOptionPageOut(BaseModel):
    set_code: str
    version: int
    items: list[ChoiceOptionOut]
    next_cursor: str | None


class ChoiceOptionMutationOut(BaseModel):
    choice_set: ChoiceSetSummaryOut
    option: ChoiceOptionOut


class ChoiceImportRowOut(BaseModel):
    line: int
    code: str
    action: Literal["create", "update", "error"]
    message: str | None


class ChoiceImportPreviewOut(BaseModel):
    set_code: str
    base_version: int
    created_count: int
    updated_count: int
    error_count: int
    rows: list[ChoiceImportRowOut]


class ChoiceImportApplyOut(BaseModel):
    choice_set: ChoiceSetSummaryOut
    created_count: int
    updated_count: int
    error_count: Literal[0] = 0
    rows: list[ChoiceImportRowOut]
