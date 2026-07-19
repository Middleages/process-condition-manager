"""API contracts for approval workflow and review comments."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.features.projects.schema import ProjectOut
from app.models.project import ProjectStatus

ReviewAction = Literal["request_review", "approve", "reject", "return_to_draft"]
CommentResolvedQuery = Literal["true", "false", "all"]
CommentTargetQuery = Literal["project", "cell", "all"]

TextBody = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=4000),
]
LayerKeyText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=256),
]
ParameterCodeText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=64),
]
ProjectIdText = Annotated[int, Field(ge=1)]
CommentIdText = Annotated[int, Field(ge=1)]


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class CommentCreateIn(_StrictModel):
    body: TextBody
    condition_id: int | None = Field(default=None, ge=1)
    layer_key: LayerKeyText | None = None
    parameter_code: ParameterCodeText | None = None


class CommentResolveIn(_StrictModel):
    resolved: bool


class CommentOut(_StrictModel):
    id: CommentIdText
    project_id: ProjectIdText
    body: str | None
    author: str
    condition_id: int | None = Field(default=None, ge=1)
    layer_key: str | None = Field(default=None, max_length=256)
    parameter_code: str | None = Field(default=None, max_length=64)
    resolved: bool
    resolved_by: str | None = None
    resolved_at: datetime | None = None
    deleted: bool
    deleted_by: str | None = None
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class CommentListOut(_StrictModel):
    items: list[CommentOut] = Field(default_factory=list)
    next_cursor: int | None = Field(default=None, ge=1)


class CommentQuery(_StrictModel):
    before_id: int | None = Field(default=None, ge=1)
    condition_id: int | None = Field(default=None, ge=1)
    layer_key: LayerKeyText | None = None
    parameter_code: ParameterCodeText | None = None
    resolved: CommentResolvedQuery = "all"
    target: CommentTargetQuery = "all"
    limit: int = Field(default=50, ge=1, le=100)


class TransitionIn(_StrictModel):
    action: ReviewAction
    expected_status: ProjectStatus


class TransitionOut(_StrictModel):
    project_id: int
    status: ProjectStatus
    allowed_actions: list[str] = Field(default_factory=list)
    basis_hash: str | None = None
    rule_versions: dict[str, int] | None = None
    revalidated: bool = False
    operation_id: str


class RevisionSourceOut(_StrictModel):
    id: int = Field(ge=1)
    status: ProjectStatus
    version: int = Field(ge=1)


class RevisionOut(_StrictModel):
    operation_id: str
    source: RevisionSourceOut
    revision: ProjectOut


__all__ = [
    "CommentCreateIn",
    "CommentListOut",
    "CommentOut",
    "CommentQuery",
    "CommentResolveIn",
    "RevisionOut",
    "RevisionSourceOut",
    "ReviewAction",
    "TransitionIn",
    "TransitionOut",
]
