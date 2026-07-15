"""Project aggregate persistence and resolved Profile list queries."""

from dataclasses import dataclass

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.domain.choices.rules import ResolvedChoice
from app.models.choice import ChoiceOption, ChoiceSet
from app.models.project import (
    CellValue,
    LayerCondition,
    Project,
    ProjectProfile,
    SheetLayer,
)


@dataclass(frozen=True, slots=True)
class ProjectSummary:
    project: Project
    profile: ProjectProfile
    device_type: ResolvedChoice
    project_category: ResolvedChoice
    layer_count: int
    cell_count: int


class ProjectRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def _full_load(self):
        return (
            selectinload(Project.layers)
            .selectinload(SheetLayer.conditions)
            .selectinload(LayerCondition.cell_values)
        )

    def add(self, project: Project) -> Project:
        self.session.add(project)
        return project

    async def get(self, project_id: int) -> Project | None:
        result = await self.session.execute(
            select(Project)
            .where(Project.id == project_id)
            .options(self._full_load(), selectinload(Project.profile))
        )
        return result.scalar_one_or_none()

    async def get_profile(self, project_id: int) -> tuple[Project, ProjectProfile] | None:
        row = (
            await self.session.execute(
                select(Project, ProjectProfile)
                .join(ProjectProfile, ProjectProfile.project_id == Project.id)
                .where(Project.id == project_id)
            )
        ).one_or_none()
        if row is None:
            return None
        return row[0], row[1]

    async def list_backbone_candidates(self) -> list[Project]:
        """백본 후보 — 매칭률 계산에 필요한 layer 구조만 로드한다 (셀 제외)."""
        result = await self.session.execute(
            select(Project).options(selectinload(Project.layers)).order_by(Project.id.desc())
        )
        return list(result.scalars().all())

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
        device_type_code: str | None = None,
        project_category_code: str | None = None,
        cursor: int | None = None,
        limit: int = 50,
    ) -> tuple[list[ProjectSummary], int | None]:
        """Resolve Profile choices and aggregate counts in one SQL page path."""
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

        device_set = aliased(ChoiceSet, name="device_set")
        device_option = aliased(ChoiceOption, name="device_option")
        category_set = aliased(ChoiceSet, name="category_set")
        category_option = aliased(ChoiceOption, name="category_option")
        stmt = (
            select(
                Project,
                ProjectProfile,
                device_option.label.label("device_label"),
                device_set.is_active.label("device_set_active"),
                device_option.is_active.label("device_option_active"),
                category_option.label.label("category_label"),
                category_set.is_active.label("category_set_active"),
                category_option.is_active.label("category_option_active"),
                layer_count.label("layer_count"),
                cell_count.label("cell_count"),
            )
            .join(ProjectProfile, ProjectProfile.project_id == Project.id)
            .join(device_set, device_set.code == "device_type")
            .join(
                device_option,
                and_(
                    device_option.choice_set_id == device_set.id,
                    device_option.code == ProjectProfile.device_type_code,
                ),
            )
            .join(category_set, category_set.code == "project_category")
            .join(
                category_option,
                and_(
                    category_option.choice_set_id == category_set.id,
                    category_option.code == ProjectProfile.project_category_code,
                ),
            )
        )
        if query is not None and (search := query.strip()):
            like = f"%{search}%"
            stmt = stmt.where(
                or_(
                    Project.name.ilike(like),
                    Project.line_id.ilike(like),
                    Project.process_id.ilike(like),
                    Project.part_id.ilike(like),
                    ProjectProfile.comment.ilike(like),
                    ProjectProfile.device_type_code.ilike(like),
                    device_option.label.ilike(like),
                    ProjectProfile.project_category_code.ilike(like),
                    category_option.label.ilike(like),
                )
            )
        if status:
            stmt = stmt.where(Project.status == status)
        if device_type_code is not None:
            stmt = stmt.where(
                ProjectProfile.device_type_code == device_type_code.strip()
            )
        if project_category_code is not None:
            stmt = stmt.where(
                ProjectProfile.project_category_code == project_category_code.strip()
            )
        if cursor is not None:
            stmt = stmt.where(Project.id < cursor)
        stmt = stmt.order_by(Project.id.desc()).limit(limit + 1)

        rows = (await self.session.execute(stmt)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        summaries = [
            ProjectSummary(
                project=row[0],
                profile=row[1],
                device_type=ResolvedChoice(
                    set_code="device_type",
                    option_code=row[1].device_type_code,
                    label=row.device_label,
                    set_is_active=row.device_set_active,
                    option_is_active=row.device_option_active,
                ),
                project_category=ResolvedChoice(
                    set_code="project_category",
                    option_code=row[1].project_category_code,
                    label=row.category_label,
                    set_is_active=row.category_set_active,
                    option_is_active=row.category_option_active,
                ),
                layer_count=int(row.layer_count),
                cell_count=int(row.cell_count),
            )
            for row in rows
        ]
        next_cursor = summaries[-1].project.id if has_more and summaries else None
        return summaries, next_cursor
