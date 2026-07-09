"""프로젝트 저장소."""

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import CellValue, LayerCondition, Project, SheetLayer

ProjectSummary = tuple[Project, int, int]


class ProjectRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def _full_load(self):
        return (
            selectinload(Project.layers)
            .selectinload(SheetLayer.conditions)
            .selectinload(LayerCondition.cell_values)
        )

    async def add(self, project: Project) -> Project:
        self.session.add(project)
        await self.session.flush()
        return project

    async def get(self, project_id: int) -> Project | None:
        result = await self.session.execute(
            select(Project).where(Project.id == project_id).options(self._full_load())
        )
        return result.scalar_one_or_none()

    async def processes_with_projects(self) -> set[tuple[str, str]]:
        """조건표(프로젝트)가 하나라도 있는 (line_id, process_id) 집합."""
        rows = await self.session.execute(
            select(Project.line_id, Project.process_id).distinct()
        )
        return {(row[0], row[1]) for row in rows.all()}

    async def count_by_process(self, line_id: str, process_id: str) -> int:
        stmt = select(func.count(Project.id)).where(
            Project.line_id == line_id, Project.process_id == process_id
        )
        return int((await self.session.execute(stmt)).scalar_one())

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

    async def list_summaries(
        self,
        *,
        query: str | None = None,
        status: str | None = None,
        cursor: int | None = None,
        limit: int = 50,
    ) -> tuple[list[ProjectSummary], int | None]:
        """목록용 요약(집계 카운트)만 조회한다 — 셀 트리를 로드하지 않는다."""
        layer_count = (
            select(func.count(SheetLayer.id))
            .where(SheetLayer.project_id == Project.id)
            .correlate(Project)
            .scalar_subquery()
        )
        cell_count = (
            select(func.count(CellValue.id))
            .select_from(CellValue)
            .join(LayerCondition, CellValue.condition_id == LayerCondition.id)
            .join(SheetLayer, LayerCondition.layer_id == SheetLayer.id)
            .where(SheetLayer.project_id == Project.id)
            .correlate(Project)
            .scalar_subquery()
        )
        stmt = select(
            Project, layer_count.label("layer_count"), cell_count.label("cell_count")
        )
        if query:
            like = f"%{query.strip()}%"
            stmt = stmt.where(
                or_(
                    Project.name.ilike(like),
                    Project.line_id.ilike(like),
                    Project.process_id.ilike(like),
                    Project.part_id.ilike(like),
                )
            )
        if status:
            stmt = stmt.where(Project.status == status)
        if cursor is not None:
            stmt = stmt.where(Project.id < cursor)
        stmt = stmt.order_by(Project.id.desc()).limit(limit + 1)

        rows = (await self.session.execute(stmt)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        summaries: list[ProjectSummary] = [
            (row[0], int(row.layer_count), int(row.cell_count)) for row in rows
        ]
        next_cursor = summaries[-1][0].id if has_more and summaries else None
        return summaries, next_cursor
