"""편집 잠금 API 스키마 (Pydantic v2)."""

from datetime import datetime

from pydantic import BaseModel


class LockOut(BaseModel):
    """잠금 획득/하트비트 응답 — 보유자, 발급 토큰, 만료 시각."""

    locked_by: str
    lock_token: str
    locked_at: datetime
    expires_at: datetime


class LockHeartbeatIn(BaseModel):
    """하트비트 요청 — 보유 중인 토큰으로 만료를 연장한다."""

    lock_token: str


class LockReleaseIn(BaseModel):
    """해제 요청 — 보유 중인 토큰으로 잠금을 삭제한다."""

    lock_token: str
