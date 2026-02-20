"""Admin User management schemas."""
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, field_validator


class AdminUserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    display_name: str = Field(..., min_length=1, max_length=100)
    email: str | None = Field(None, max_length=255)
    role: str = Field("editor")
    password: str = Field(..., min_length=4, max_length=100)

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        if v not in ("editor", "reviewer", "admin"):
            raise ValueError("role must be one of: editor, reviewer, admin")
        return v


class AdminUserUpdate(BaseModel):
    display_name: str | None = Field(None, max_length=100)
    email: str | None = None
    role: str | None = None
    is_active: bool | None = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        if v is not None and v not in ("editor", "reviewer", "admin"):
            raise ValueError("role must be one of: editor, reviewer, admin")
        return v


class AdminPasswordReset(BaseModel):
    new_password: str = Field(..., min_length=4, max_length=100)


class AdminUserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    email: str | None = None
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
