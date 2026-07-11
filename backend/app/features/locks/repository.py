"""편집 잠금 저장소 (순수 영속화).

edit_lock 모델을 직접 다룬다 — 다른 feature를 import하지 않는다.
project 존재 확인도 모델을 직접 조회한다 (projects 슬라이스에 의존하지 않음).
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import EditLock, Project


class EditLockRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, project_id: int) -> EditLock | None:
        """PK(project_id) 단건 조회 (identity map 우선)."""
        return await self.session.get(EditLock, project_id)

    async def project_exists(self, project_id: int) -> bool:
        """잠금 대상 프로젝트 실재 여부 (FK 위반 전에 깔끔한 404를 내기 위함)."""
        result = await self.session.execute(
            select(Project.id).where(Project.id == project_id)
        )
        return result.scalar_one_or_none() is not None

    def add(self, lock: EditLock) -> None:
        self.session.add(lock)

    async def delete(self, lock: EditLock) -> None:
        await self.session.delete(lock)

    async def flush(self) -> None:
        await self.session.flush()
