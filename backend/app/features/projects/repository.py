"""Project aggregate persistence and resolved Profile list queries."""

from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import Text, and_, cast, func, or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.core.errors import ConflictError
from app.domain.choices.rules import ResolvedChoice
from app.domain.parameters.types import ValueType
from app.models.choice import ChoiceOption, ChoiceSet
from app.models.parameter import Parameter
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
    successor_id: int | None


@dataclass(frozen=True, slots=True)
class CapturedParameter:
    parameter_code: str
    value_type: ValueType | str
    display_name: str
    category_code: str | None
    sort_order: int
    active_at_capture: bool


@dataclass(frozen=True, slots=True)
class CapturedParameterRegistry:
    parameters: tuple[CapturedParameter, ...]
    unresolved_codes: tuple[str, ...]


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

    async def get_for_update(self, project_id: int) -> Project | None:
        result = await self.session.execute(
            select(Project)
            .where(Project.id == project_id)
            .options(self._full_load(), selectinload(Project.profile))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def capture_source_project(
        self, project_id: int, *, locked_target: Project | None = None
    ) -> Project | None:
        if locked_target is not None and locked_target.id == project_id:
            return locked_target

        stmt = (
            select(Project)
            .where(Project.id == project_id)
            .options(self._full_load(), selectinload(Project.profile))
            .with_for_update(read=True, nowait=True)
            .execution_options(populate_existing=True)
        )
        try:
            result = await self.session.execute(stmt)
        except DBAPIError as exc:
            if _is_lock_not_available(exc):
                raise ConflictError(
                    f"소스 프로젝트를 점유할 수 없다: {project_id}",
                    code="source_project_busy",
                    details={"project_id": project_id, "retryable": True},
                ) from exc
            raise
        return result.scalar_one_or_none()

    async def capture_parameter_registry(
        self,
        stored_source_cell_codes: Collection[str] | None = None,
    ) -> CapturedParameterRegistry:
        requested_codes = tuple(sorted({code for code in stored_source_cell_codes or ()}))
        stmt = (
            select(Parameter)
            .options(selectinload(Parameter.category))
            .order_by(Parameter.sort_order, Parameter.code)
        )
        if requested_codes:
            stmt = stmt.where(
                or_(
                    Parameter.is_active.is_(True),
                    Parameter.code.in_(requested_codes),
                )
            )
        else:
            stmt = stmt.where(Parameter.is_active.is_(True))

        rows = list((await self.session.execute(stmt)).scalars().all())
        rows_by_code = {row.code: row for row in rows}
        unresolved_codes = tuple(code for code in requested_codes if code not in rows_by_code)
        parameters = tuple(
            CapturedParameter(
                parameter_code=row.code,
                value_type=row.value_type,
                display_name=row.display_name,
                category_code=row.category.code if row.category is not None else None,
                sort_order=row.sort_order,
                active_at_capture=row.is_active,
            )
            for row in rows
        )
        return CapturedParameterRegistry(
            parameters=parameters,
            unresolved_codes=unresolved_codes,
        )

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
        rows = await self.session.execute(select(Project.line_id, Project.process_id).distinct())
        return {(row[0], row[1]) for row in rows.all()}

    async def count_by_process(self, line_id: str, process_id: str) -> int:
        stmt = select(func.count(Project.id)).where(
            Project.line_id == line_id, Project.process_id == process_id
        )
        return int((await self.session.execute(stmt)).scalar_one())

    async def get_by_identity(self, line_id: str, process_id: str, part_id: str) -> Project | None:
        result = await self.session.execute(
            select(Project).where(
                Project.line_id == line_id,
                Project.process_id == process_id,
                Project.part_id == part_id,
            ).order_by(Project.version.desc(), Project.id.desc()).limit(1)
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
        """Load a page without coupling frozen rows to live ChoiceSet joins."""
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
        successor = aliased(Project, name="successor")
        successor_id = (
            select(func.max(successor.id))
            .where(successor.revision_of_id == Project.id)
            .correlate(Project)
            .scalar_subquery()
            .label("successor_id")
        )

        stmt = select(
            Project,
            ProjectProfile,
            layer_count.label("layer_count"),
            cell_count.label("cell_count"),
            successor_id.label("successor_id"),
        ).join(ProjectProfile, ProjectProfile.project_id == Project.id)
        if query is not None and (search := query.strip()):
            like = f"%{search}%"
            frozen_statuses = ("approved", "archived")
            label_predicates = []
            if status not in frozen_statuses:
                device_set = aliased(ChoiceSet, name="search_device_set")
                device_option = aliased(ChoiceOption, name="search_device_option")
                category_set = aliased(ChoiceSet, name="search_category_set")
                category_option = aliased(ChoiceOption, name="search_category_option")
                live_label_match = or_(
                    select(1)
                    .select_from(device_option)
                    .join(device_set, device_option.choice_set_id == device_set.id)
                    .where(
                        device_set.code == "device_type",
                        device_option.code == ProjectProfile.device_type_code,
                        device_option.label.ilike(like),
                    )
                    .exists(),
                    select(1)
                    .select_from(category_option)
                    .join(category_set, category_option.choice_set_id == category_set.id)
                    .where(
                        category_set.code == "project_category",
                        category_option.code == ProjectProfile.project_category_code,
                        category_option.label.ilike(like),
                    )
                    .exists(),
                )
                label_predicates.append(
                    live_label_match
                    if status is not None
                    else and_(Project.status.not_in(frozen_statuses), live_label_match)
                )
            if status is None or status in frozen_statuses:
                frozen_label_match = cast(Project.parameter_snapshot, Text).ilike(like)
                label_predicates.append(
                    frozen_label_match
                    if status is not None
                    else and_(Project.status.in_(frozen_statuses), frozen_label_match)
                )
            stmt = stmt.where(
                or_(
                    Project.name.ilike(like),
                    Project.line_id.ilike(like),
                    Project.process_id.ilike(like),
                    Project.part_id.ilike(like),
                    ProjectProfile.comment.ilike(like),
                    ProjectProfile.device_type_code.ilike(like),
                    ProjectProfile.project_category_code.ilike(like),
                    *label_predicates,
                )
            )
        if status:
            stmt = stmt.where(Project.status == status)
        if device_type_code is not None:
            stmt = stmt.where(ProjectProfile.device_type_code == device_type_code.strip())
        if project_category_code is not None:
            stmt = stmt.where(ProjectProfile.project_category_code == project_category_code.strip())
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
                    label=row[1].device_type_code,
                    set_is_active=False,
                    option_is_active=False,
                ),
                project_category=ResolvedChoice(
                    set_code="project_category",
                    option_code=row[1].project_category_code,
                    label=row[1].project_category_code,
                    set_is_active=False,
                    option_is_active=False,
                ),
                layer_count=int(row.layer_count),
                cell_count=int(row.cell_count),
                successor_id=row.successor_id,
            )
            for row in rows
        ]
        next_cursor = summaries[-1].project.id if has_more and summaries else None
        return summaries, next_cursor


def _is_lock_not_available(exc: DBAPIError) -> bool:
    """Normalize PostgreSQL lock-conflict SQLSTATE across DB drivers."""
    if exc.orig is None:
        return False
    code = _dbapi_sqlstate(exc.orig)
    return code == "55P03"


def _dbapi_sqlstate(error: BaseException) -> str | None:
    for attr in ("sqlstate", "pgcode"):
        code = getattr(error, attr, None)
        if code:
            return str(code)
    args = getattr(error, "args", ())
    if args:
        first = args[0]
        if isinstance(first, str) and len(first) == 5 and first.isalnum():
            return first
    return None
