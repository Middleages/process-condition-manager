"""공지사항 Pydantic 스키마."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.constants import ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_PRIORITIES


class AnnouncementCreate(BaseModel):
    """공지사항 생성 요청 스키마."""
    title: str = Field(..., max_length=200)
    content: str = Field(...)
    category: str = Field("general")
    priority: str = Field("normal")
    is_pinned: bool = Field(False)

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        """카테고리 값 검증."""
        if v not in ANNOUNCEMENT_CATEGORIES:
            raise ValueError(f"category must be one of {ANNOUNCEMENT_CATEGORIES}")
        return v

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str) -> str:
        """우선순위 값 검증."""
        if v not in ANNOUNCEMENT_PRIORITIES:
            raise ValueError(f"priority must be one of {ANNOUNCEMENT_PRIORITIES}")
        return v


class AnnouncementUpdate(BaseModel):
    """공지사항 수정 요청 스키마."""
    title: str | None = None
    content: str | None = None
    category: str | None = None
    priority: str | None = None
    is_pinned: bool | None = None

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str | None) -> str | None:
        """카테고리 값 검증 (Optional)."""
        if v is not None and v not in ANNOUNCEMENT_CATEGORIES:
            raise ValueError(f"category must be one of {ANNOUNCEMENT_CATEGORIES}")
        return v

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str | None) -> str | None:
        """우선순위 값 검증 (Optional)."""
        if v is not None and v not in ANNOUNCEMENT_PRIORITIES:
            raise ValueError(f"priority must be one of {ANNOUNCEMENT_PRIORITIES}")
        return v


class AnnouncementResponse(BaseModel):
    """공지사항 응답 스키마."""
    id: int
    title: str
    content: str
    category: str
    priority: str
    is_active: bool
    is_pinned: bool
    created_by: int
    created_at: datetime
    updated_at: datetime
    is_read: bool = False
    creator_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class AnnouncementListResponse(BaseModel):
    """공지사항 목록 응답 스키마."""
    items: list[AnnouncementResponse]
    total: int


class UnreadCountResponse(BaseModel):
    """읽지 않은 공지 수 응답 스키마."""
    count: int
