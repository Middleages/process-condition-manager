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

    async def lock_project(self, project_id: int) -> bool:
        """프로젝트 행을 트랜잭션 종료까지 잠가 잠금 생명주기를 직렬화한다.

        edit_lock은 최초 획득 전에는 행이 없으므로 그 행 자체를 잠글 수 없다. 항상 존재하는
        project 행을 잠금 mutex로 사용하면 최초 INSERT, 만료 탈취, heartbeat/release와 편집
        요청을 프로젝트 단위로 같은 순서에 세울 수 있다. SQLite 테스트에서는 FOR UPDATE가
        무시되지만 운영 PostgreSQL에서는 실제 행 잠금으로 동작한다.
        """
        result = await self.session.execute(
            select(Project.id).where(Project.id == project_id).with_for_update()
        )
        return result.scalar_one_or_none() is not None

    def add(self, lock: EditLock) -> None:
        self.session.add(lock)

    async def delete(self, lock: EditLock) -> None:
        await self.session.delete(lock)

    async def flush(self) -> None:
        await self.session.flush()
