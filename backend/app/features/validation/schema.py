"""Strict public JSON contract for typed validation rules."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.domain.validation.types import ValidationSeverity

CodeText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=64,
        pattern=r"^[a-z][a-z0-9_]*$",
    ),
]
NameText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
DescriptionText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)
]
ScopeText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
LiteralText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
ExpectedVersion = Annotated[int, Field(strict=True, ge=1)]


class _StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _reject_duplicates(values: list[str]) -> list[str]:
    if len(values) != len(set(values)):
        raise ValueError("scope values must be unique")
    return values


class ValidationLayersIn(_StrictRequest):
    layer_ids: list[ScopeText] | None = None
    step_seqs: list[ScopeText] | None = None
    eqp_types: list[ScopeText] | None = None
    area_names: list[ScopeText] | None = None

    @field_validator("layer_ids", "step_seqs", "eqp_types", "area_names")
    @classmethod
    def validate_filter(cls, values: list[str] | None) -> list[str] | None:
        if values is not None and not values:
            raise ValueError("scope arrays must not be empty")
        return None if values is None else _reject_duplicates(values)

    @model_validator(mode="after")
    def reject_explicit_null(self) -> "ValidationLayersIn":
        if any(
            field in self.model_fields_set and getattr(self, field) is None
            for field in ("layer_ids", "step_seqs", "eqp_types", "area_names")
        ):
            raise ValueError("scope filters must be omitted instead of null")
        return self


class ValidationScopeIn(_StrictRequest):
    line_ids: list[ScopeText] | None = None
    process_ids: list[ScopeText] | None = None
    layers: ValidationLayersIn | None = None

    @field_validator("line_ids", "process_ids")
    @classmethod
    def validate_filter(cls, values: list[str] | None) -> list[str] | None:
        if values is not None and not values:
            raise ValueError("scope arrays must not be empty")
        return None if values is None else _reject_duplicates(values)

    @model_validator(mode="after")
    def reject_explicit_null(self) -> "ValidationScopeIn":
        if any(
            field in self.model_fields_set and getattr(self, field) is None
            for field in ("line_ids", "process_ids", "layers")
        ):
            raise ValueError("scope filters must be omitted instead of null")
        return self


class RequiredIfSpecIn(_StrictRequest):
    schema_version: Literal[1]
    type: Literal["required_if"]
    when_parameter_code: CodeText
    equals: LiteralText
    required_parameter_code: CodeText

    @field_validator("schema_version", mode="before")
    @classmethod
    def validate_schema_version(cls, value: object) -> object:
        if type(value) is not int or value != 1:
            raise ValueError("schema_version must be the integer 1")
        return value


class PriorPorSpecIn(_StrictRequest):
    schema_version: Literal[1]
    type: Literal["value_exists_in_prior_por"]
    source_parameter_code: CodeText
    candidate_parameter_code: CodeText

    @field_validator("schema_version", mode="before")
    @classmethod
    def validate_schema_version(cls, value: object) -> object:
        if type(value) is not int or value != 1:
            raise ValueError("schema_version must be the integer 1")
        return value


ValidationRuleSpecIn = Annotated[
    RequiredIfSpecIn | PriorPorSpecIn,
    Field(discriminator="type"),
]


class ValidationRuleCreateIn(_StrictRequest):
    code: CodeText
    name: NameText
    description: DescriptionText | None = None
    severity: ValidationSeverity
    scope: ValidationScopeIn = Field(default_factory=ValidationScopeIn)
    spec: ValidationRuleSpecIn
    is_active: bool = True


class ValidationRulePatchIn(_StrictRequest):
    expected_version: ExpectedVersion
    name: NameText | None = None
    description: DescriptionText | None = None
    severity: ValidationSeverity | None = None
    scope: ValidationScopeIn | None = None
    spec: ValidationRuleSpecIn | None = None
    is_active: bool | None = None


class ValidationRuleOut(BaseModel):
    code: str
    name: str
    description: str | None
    severity: ValidationSeverity
    scope: dict[str, object]
    spec: ValidationRuleSpecIn
    version: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
