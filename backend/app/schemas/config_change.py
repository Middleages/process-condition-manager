"""설정 변경 합의(Config Change Consensus) Pydantic 스키마.

요청 생성, 투표, 상세 조회, 목록 조회에 사용되는 요청/응답 모델을 정의한다.
"""
from datetime import datetime

from pydantic import BaseModel, field_validator

from app.constants import CONFIG_CHANGE_TYPES


# ---------------------------------------------------------------------------
# 요청(Request) 스키마
# ---------------------------------------------------------------------------


class ConfigChangeCreateRequest(BaseModel):
    """설정 변경 요청 생성 스키마."""
    title: str
    description: str
    change_type: str

    @field_validator("title")
    @classmethod
    def title_max_length(cls, v: str) -> str:
        if len(v) > 200:
            raise ValueError("제목은 200자를 초과할 수 없습니다")
        if not v.strip():
            raise ValueError("제목은 비어 있을 수 없습니다")
        return v.strip()

    @field_validator("description")
    @classmethod
    def description_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("설명은 비어 있을 수 없습니다")
        return v.strip()

    @field_validator("change_type")
    @classmethod
    def validate_change_type(cls, v: str) -> str:
        if v not in CONFIG_CHANGE_TYPES:
            raise ValueError(
                f"유효하지 않은 변경 유형입니다. 허용값: {', '.join(CONFIG_CHANGE_TYPES)}"
            )
        return v


class ConfigChangeVoteRequest(BaseModel):
    """설정 변경 투표 스키마."""
    vote: str
    reason: str | None = None

    @field_validator("vote")
    @classmethod
    def validate_vote(cls, v: str) -> str:
        if v not in ("approve", "reject"):
            raise ValueError("투표는 'approve' 또는 'reject'만 가능합니다")
        return v

    @field_validator("reason")
    @classmethod
    def reject_requires_reason(cls, v: str | None) -> str | None:
        """반려(reject) 투표 시 사유 필수 검증은 서비스 레이어에서 수행."""
        if v is not None and not v.strip():
            return None
        return v


# ---------------------------------------------------------------------------
# 응답(Response) 스키마
# ---------------------------------------------------------------------------


class VoteSummary(BaseModel):
    """투표 요약 정보."""
    total: int
    approved: int
    rejected: int
    pending: int


class ConfigChangeResponse(BaseModel):
    """설정 변경 요청 응답 스키마 (목록 조회용)."""
    id: int
    title: str
    description: str
    change_type: str
    status: str
    requested_by: int
    requester_name: str | None = None
    implemented_by: int | None = None
    implementer_name: str | None = None
    created_at: datetime
    updated_at: datetime
    approved_at: datetime | None = None
    completed_at: datetime | None = None
    vote_summary: VoteSummary | None = None

    model_config = {"from_attributes": True}


class ConfigChangeVoteResponse(BaseModel):
    """개별 투표 응답 스키마."""
    id: int
    line_id: int
    line_name: str | None = None
    line_code: str | None = None
    vote: str | None = None
    voted_by: int | None = None
    voter_name: str | None = None
    reason: str | None = None
    voted_at: datetime | None = None

    model_config = {"from_attributes": True}


class ConfigChangeDetailResponse(ConfigChangeResponse):
    """설정 변경 요청 상세 응답 스키마 (투표 목록 포함)."""
    votes: list[ConfigChangeVoteResponse] = []


class ConfigChangeListResponse(BaseModel):
    """설정 변경 요청 목록 응답 스키마."""
    items: list[ConfigChangeResponse]
    total: int
