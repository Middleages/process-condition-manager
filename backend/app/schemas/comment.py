"""
Pydantic schemas for review comments.
"""
from datetime import datetime
from pydantic import BaseModel, field_validator


class CommentCreate(BaseModel):
    """Request schema for creating a comment."""
    user_id: int
    project_layer_id: int | None = None
    column_name: str | None = None
    content: str
    comment_type: str = "general"  # "general" or "rejection"

    @field_validator("content")
    @classmethod
    def content_max_length(cls, v: str) -> str:
        """Validate content max length is 2000 characters."""
        if len(v) > 2000:
            raise ValueError("Comment must not exceed 2000 characters")
        if not v.strip():
            raise ValueError("Comment cannot be empty")
        return v


class CommentUpdate(BaseModel):
    """Request schema for updating a comment."""
    content: str | None = None
    is_resolved: bool | None = None
    resolved_by: int | None = None


class CommentResponse(BaseModel):
    """Response schema for a single comment with joined data."""
    id: int
    project_id: int
    project_layer_id: int | None
    layer_name: str | None
    column_name: str | None
    column_display_name: str | None
    content: str
    comment_type: str
    is_resolved: bool
    created_by: int
    creator_name: str
    creator_role: str
    created_at: datetime
    resolved_at: datetime | None
    resolved_by: int | None
    resolver_name: str | None

    model_config = {"from_attributes": True}


class CommentListResponse(BaseModel):
    """Response schema for list of comments."""
    comments: list[CommentResponse]
    total: int
    unresolved_count: int
