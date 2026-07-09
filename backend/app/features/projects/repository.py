"""프로젝트 저장소."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import LayerCondition, Project, SheetLayer


class ProjectRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, project: Project) -> Project:
        self.session.add(project)
        await self.session.flush()
        return project

    async def get(self, project_id: int) -> Project | None:
        result = await self.session.execute(
            select(Project)
            .where(Project.id == project_id)
            .options(
                selectinload(Project.layers)
                .selectinload(SheetLayer.conditions)
                .selectinload(LayerCondition.cell_values)
            )
        )
        return result.scalar_one_or_none()

    async def get_by_identity(
        self, line_id: str, process_id: str, part_id: str
    ) -> Project | None:
        result = await self.session.execute(
            select(Project).where(
                Project.line_id == line_id,
                Project.process_id == process_id,
                Project.part_id == part_id,
            )
        )
        return result.scalar_one_or_none()

    async def list(self) -> list[Project]:
        result = await self.session.execute(
            select(Project)
            .options(
                selectinload(Project.layers)
                .selectinload(SheetLayer.conditions)
                .selectinload(LayerCondition.cell_values)
            )
            .order_by(Project.id)
        )
        return list(result.scalars().all())
