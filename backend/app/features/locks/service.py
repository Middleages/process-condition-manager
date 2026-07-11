"""편집 잠금 서비스 (획득/하트비트/해제).

잠금 소유는 사용자 + lock_token(불투명 토큰)으로 식별한다 (P2-D6).
- 획득: 유효 잠금이 없거나 만료면 새 토큰 발급 + upsert. 유효 잠금이 있으면 409
        (같은 사용자여도 — 두 탭 중 한쪽만 편집)
- 하트비트: 토큰 일치 + 미만료면 만료 연장, 아니면 409
- 해제: 토큰+보유자 일치 시 삭제. 그 외(잠금 없음/토큰 불일치)는 무해한 no-op
        (idempotent) — 탈취된 잠금을 옛 세션이 뒤늦게 지우지 않도록.
"""

import uuid
from datetime import timedelta

from app.core.config import settings
from app.core.errors import LockConflictError, NotFoundError
from app.core.locks import is_expired, is_valid_holder, lock_holder_details, utcnow
from app.features.locks.repository import EditLockRepository
from app.models.project import EditLock


class LockService:
    def __init__(self, repo: EditLockRepository) -> None:
        self.repo = repo

    async def acquire(self, project_id: int, *, user_id: str) -> EditLock:
        if not await self.repo.project_exists(project_id):
            raise NotFoundError(f"프로젝트를 찾을 수 없다: {project_id}")

        now = utcnow()
        lock = await self.repo.get(project_id)
        if lock is not None and not is_expired(lock, now):
            raise LockConflictError(
                "다른 세션이 이미 편집 중이다", details=lock_holder_details(lock)
            )

        token = uuid.uuid4().hex
        expires_at = now + timedelta(seconds=settings.edit_lock_ttl_seconds)
        if lock is None:
            lock = EditLock(
                project_id=project_id,
                locked_by=user_id,
                lock_token=token,
                locked_at=now,
                expires_at=expires_at,
            )
            self.repo.add(lock)
        else:
            # 만료 잠금 탈취: 같은 행을 새 보유자/토큰으로 덮어쓴다.
            lock.locked_by = user_id
            lock.lock_token = token
            lock.locked_at = now
            lock.expires_at = expires_at
        await self.repo.flush()
        return lock

    async def heartbeat(
        self, project_id: int, *, user_id: str, lock_token: str
    ) -> EditLock:
        now = utcnow()
        lock = await self.repo.get(project_id)
        if not is_valid_holder(lock, user_id=user_id, token=lock_token, now=now):
            raise LockConflictError(
                "편집 잠금이 만료되었거나 보유자가 아니다",
                details=lock_holder_details(lock),
            )
        assert lock is not None  # is_valid_holder가 True면 lock은 not None
        lock.expires_at = now + timedelta(seconds=settings.edit_lock_ttl_seconds)
        await self.repo.flush()
        return lock

    async def release(self, project_id: int, *, user_id: str, lock_token: str) -> None:
        lock = await self.repo.get(project_id)
        if lock is None:
            return  # 이미 없음 — idempotent
        # 토큰+보유자가 일치할 때만 삭제한다. 불일치면 (탈취된 잠금일 수 있으므로)
        # 새 보유자의 잠금을 건드리지 않고 조용히 no-op 한다.
        if lock.locked_by == user_id and lock.lock_token == lock_token:
            await self.repo.delete(lock)
            await self.repo.flush()
