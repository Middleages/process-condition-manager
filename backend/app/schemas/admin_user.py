"""Admin 사용자 관리 스키마."""
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, field_validator

from app.constants import VALID_ROLES


class AdminUserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    display_name: str = Field(..., min_length=1, max_length=100)
    email: str | None = Field(None, max_length=255)
    roles: list[str] = Field(default=["editor"])
    password: str = Field(..., min_length=4, max_length=100)

    @field_validator("roles")
    @classmethod
    def validate_roles(cls, v: list[str]) -> list[str]:
        """역할 목록 유효성 검증: 빈 목록 불가, 유효한 역할만 허용, 중복 제거."""
        if not v:
            raise ValueError("roles must not be empty")
        # 중복 제거 (순서 유지)
        seen: set[str] = set()
        deduped: list[str] = []
        for role in v:
            if role not in seen:
                seen.add(role)
                deduped.append(role)
        invalid = seen - VALID_ROLES
        if invalid:
            raise ValueError(
                f"Invalid role(s): {', '.join(sorted(invalid))}. "
                f"Must be one of: {', '.join(sorted(VALID_ROLES))}"
            )
        return deduped


class AdminUserUpdate(BaseModel):
    display_name: str | None = Field(None, max_length=100)
    email: str | None = None
    roles: list[str] | None = None
    is_active: bool | None = None

    @field_validator("roles")
    @classmethod
    def validate_roles(cls, v: list[str] | None) -> list[str] | None:
        """역할 목록 유효성 검증: None이면 패스, 빈 목록 불가, 유효한 역할만 허용, 중복 제거."""
        if v is None:
            return v
        if not v:
            raise ValueError("roles must not be empty")
        seen: set[str] = set()
        deduped: list[str] = []
        for role in v:
            if role not in seen:
                seen.add(role)
                deduped.append(role)
        invalid = seen - VALID_ROLES
        if invalid:
            raise ValueError(
                f"Invalid role(s): {', '.join(sorted(invalid))}. "
                f"Must be one of: {', '.join(sorted(VALID_ROLES))}"
            )
        return deduped


class AdminPasswordReset(BaseModel):
    new_password: str = Field(..., min_length=4, max_length=100)


class AdminUserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    email: str | None = None
    roles: list[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
