"""편집 잠금 공용 인프라 (P2-D6).

auth.py/db.py처럼 공용 경계로 취급한다 — features/*가 이 모듈을 import해도
feature-to-feature 결합이 아니다. 잠금 시간 헬퍼, 판정 술어, 그리고 편집 계열
API가 공용으로 거는 잠금 검사 의존성(require_edit_lock)을 모아둔다.

시간대 강건성: PostgreSQL은 aware datetime을, SQLite(테스트)는 naive를 돌려준다.
저장은 항상 UTC(utcnow)로 하고, 비교 직전 as_utc로 기준을 통일한다.
"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import UserContext, get_current_user
from app.core.db import get_app_session
from app.core.errors import LockConflictError
from app.models.project import EditLock, Project


def utcnow() -> datetime:
    """항상 tz-aware UTC 현재 시각."""
    return datetime.now(UTC)


def as_utc(dt: datetime) -> datetime:
    """비교/직렬화 기준을 UTC로 통일한다.

    naive(SQLite 반환)는 UTC로 간주하고, aware(PG 반환)는 UTC로 변환한다.
    저장을 항상 utcnow로 하므로 naive를 UTC로 간주해도 안전하다.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def is_expired(lock: EditLock, now: datetime) -> bool:
    """잠금 만료 여부 (만료 시각 도달을 만료로 본다)."""
    return as_utc(lock.expires_at) <= now


def is_valid_holder(
    lock: EditLock | None, *, user_id: str, token: str | None, now: datetime
) -> bool:
    """현재 사용자+토큰이 유효(미만료) 잠금의 보유자인지 판정한다."""
    if lock is None or token is None:
        return False
    if is_expired(lock, now):
        return False
    return lock.locked_by == user_id and lock.lock_token == token


def lock_holder_details(lock: EditLock | None) -> dict[str, str | None]:
    """409 응답 details에 실을 보유자 정보.

    JSONResponse는 표준 json.dumps를 쓰므로 datetime을 직접 넣을 수 없다 —
    ISO 문자열로 직렬화한다.
    """
    if lock is None:
        return {"locked_by": None, "locked_at": None, "expires_at": None}
    return {
        "locked_by": lock.locked_by,
        "locked_at": as_utc(lock.locked_at).isoformat(),
        "expires_at": as_utc(lock.expires_at).isoformat(),
    }


async def require_edit_lock(
    project_id: int,
    user: Annotated[UserContext, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_app_session, scope="function")],
    x_lock_token: Annotated[str | None, Header()] = None,
) -> None:
    """편집 계열 API 공용 잠금 검사 의존성.

    헤더 X-Lock-Token + path의 project_id + 현재 사용자로 유효 보유자인지 확인한다.
    미획득/미보유/토큰 불일치/만료면 409(LockConflictError)로 거절한다.
    같은 앱 세션을 다른 의존성과 공유하므로(FastAPI 캐시) 추가 커넥션을 쓰지 않는다.
    """
    # edit_lock은 최초 획득 전에는 행이 없으므로 항상 존재하는 project 행을 mutex로 쓴다.
    # 같은 세션을 실제 편집 서비스까지 공유해 commit 시점까지 행 잠금을 유지함으로써,
    # 검증 직후 TTL 탈취가 일어나 옛 토큰의 쓰기가 뒤늦게 커밋되는 TOCTOU를 막는다.
    await session.execute(
        select(Project.id).where(Project.id == project_id).with_for_update()
    )
    lock = await session.get(EditLock, project_id)
    if not is_valid_holder(lock, user_id=user.id, token=x_lock_token, now=utcnow()):
        raise LockConflictError(
            "편집 잠금을 보유하고 있지 않다", details=lock_holder_details(lock)
        )
