"""Admin API schemas for XML mappings and validation rules."""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field, field_validator, ConfigDict


# ---------------------------------------------------------------------------
# Recipe XML Mapping Schemas
# ---------------------------------------------------------------------------

class RecipeMappingResponse(BaseModel):
    """Response schema for recipe XML mapping."""
    id: int
    xpath: str
    column_id: int
    column_name: str
    display_name: str
    category_code: str | None = None
    data_type: str
    value_transform: str | None = None
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RecipeMappingCreate(BaseModel):
    """Schema for creating a new recipe mapping."""
    xpath: str = Field(..., max_length=300, description="XPath expression for XML extraction")
    column_id: int = Field(..., description="Target column definition ID")
    value_transform: str | None = Field(None, description="Value transformation function")

    @field_validator("value_transform")
    @classmethod
    def validate_transform(cls, v):
        """Validate value_transform is one of allowed values."""
        if v is not None and v not in ("to_int", "to_float", "yn_to_bool"):
            raise ValueError(
                f"value_transform must be one of: to_int, to_float, yn_to_bool, null. Got: {v}"
            )
        return v


class RecipeMappingUpdate(BaseModel):
    """Schema for updating an existing recipe mapping."""
    xpath: str | None = Field(None, max_length=300)
    column_id: int | None = None
    value_transform: str | None = None
    is_active: bool | None = None

    @field_validator("value_transform")
    @classmethod
    def validate_transform(cls, v):
        """Validate value_transform is one of allowed values."""
        if v is not None and v not in ("to_int", "to_float", "yn_to_bool"):
            raise ValueError(
                f"value_transform must be one of: to_int, to_float, yn_to_bool, null. Got: {v}"
            )
        return v


# ---------------------------------------------------------------------------
# Validation Rule Schemas
# ---------------------------------------------------------------------------

class ValidationRuleCreate(BaseModel):
    """Schema for creating a validation rule."""
    rule_type: str = Field(..., description="Validation rule type")
    rule_config: dict[str, Any] = Field(..., description="Rule configuration JSON")
    error_message: str = Field(..., max_length=500, description="Error message to display")
    is_active: bool = Field(True, description="Whether rule is active")

    @field_validator("rule_type")
    @classmethod
    def validate_rule_type(cls, v):
        """Validate rule_type is one of allowed values."""
        allowed_types = ("range", "required", "conditional_required", "cross_layer")
        if v not in allowed_types:
            raise ValueError(
                f"rule_type must be one of: {', '.join(allowed_types)}. Got: {v}"
            )
        return v


class ValidationRulesReplace(BaseModel):
    """Schema for replacing all validation rules for a column."""
    validations: list[ValidationRuleCreate] = Field(..., description="New validation rules")


class ColumnValidationResponse(BaseModel):
    """Response schema for a column validation rule."""
    id: int
    rule_type: str
    rule_config: dict[str, Any]
    error_message: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class ColumnValidationsResponse(BaseModel):
    """Response schema for column with its validation rules."""
    column_id: int
    column_name: str
    display_name: str
    category_code: str
    validations: list[ColumnValidationResponse]

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Bulk Upload Schemas
# ---------------------------------------------------------------------------

class BulkUploadResponse(BaseModel):
    """Response schema for bulk validation upload."""
    total_rows: int = Field(..., description="Total rows processed")
    columns_updated: int = Field(..., description="Number of columns updated")
    rules_created: int = Field(..., description="Number of validation rules created")
    warnings: list[str] = Field(default_factory=list, description="Warnings encountered")


class BulkUploadError(BaseModel):
    """Schema for bulk upload error details."""
    row: int
    column_name: str
    error: str
