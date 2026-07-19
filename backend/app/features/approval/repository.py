"""Persistence helpers for approval transitions, revisions, and review comments."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import and_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.choice import ChoiceSet
from app.models.parameter import Parameter, ParameterCategory
from app.models.project import (
    ChangeEvent,
    EditLock,
    LayerCondition,
    Project,
    ReviewComment,
    SheetLayer,
)


class ApprovalRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def begin_consistent_transition(self) -> None:
        bind = self.session.get_bind()
        if bind.dialect.name == "postgresql":
            await self.session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))

    async def get_project(self, project_id: int) -> Project | None:
        result = await self.session.execute(
            select(Project)
            .where(Project.id == project_id)
            .options(
                selectinload(Project.layers)
                .selectinload(SheetLayer.conditions)
                .selectinload(LayerCondition.cell_values),
                selectinload(Project.profile),
            )
        )
        return result.scalar_one_or_none()

    async def project_exists(self, project_id: int) -> bool:
        result = await self.session.execute(
            select(Project.id).where(Project.id == project_id).limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def get_project_for_update(self, project_id: int) -> Project | None:
        result = await self.session.execute(
            select(Project)
            .where(Project.id == project_id)
            .options(
                selectinload(Project.layers)
                .selectinload(SheetLayer.conditions)
                .selectinload(LayerCondition.cell_values),
                selectinload(Project.profile),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def get_revision_projects_for_update(
        self, source_project_id: int, revision_root_id: int
    ) -> list[Project]:
        result = await self.session.execute(
            select(Project)
            .where(Project.id.in_({source_project_id, revision_root_id}))
            .order_by(Project.id)
            .options(
                selectinload(Project.layers)
                .selectinload(SheetLayer.conditions)
                .selectinload(LayerCondition.cell_values),
                selectinload(Project.profile),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return list(result.scalars().all())

    async def add_comment(self, comment: ReviewComment) -> None:
        self.session.add(comment)

    async def add_event(self, event: ChangeEvent) -> None:
        self.session.add(event)

    async def get_comment(self, project_id: int, comment_id: int) -> ReviewComment | None:
        result = await self.session.execute(
            select(ReviewComment).where(
                and_(
                    ReviewComment.id == comment_id,
                    ReviewComment.project_id == project_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_comment_for_update(
        self,
        project_id: int,
        comment_id: int,
    ) -> ReviewComment | None:
        result = await self.session.execute(
            select(ReviewComment)
            .where(
                and_(
                    ReviewComment.id == comment_id,
                    ReviewComment.project_id == project_id,
                )
            )
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def list_comments(
        self,
        project_id: int,
        *,
        before_id: int | None,
        condition_id: int | None,
        layer_key: str | None,
        parameter_code: str | None,
        resolved: str,
        target: str,
        limit: int,
    ) -> tuple[Sequence[ReviewComment], bool]:
        stmt = select(ReviewComment).where(ReviewComment.project_id == project_id)
        if before_id is not None:
            stmt = stmt.where(ReviewComment.id < before_id)
        if condition_id is not None:
            stmt = stmt.where(ReviewComment.condition_id == condition_id)
        if layer_key is not None:
            stmt = stmt.where(ReviewComment.layer_key == layer_key)
        if parameter_code is not None:
            stmt = stmt.where(ReviewComment.parameter_code == parameter_code)
        if target == "project":
            stmt = stmt.where(ReviewComment.condition_id.is_(None))
        elif target == "cell":
            stmt = stmt.where(ReviewComment.condition_id.is_not(None))
        if resolved == "true":
            stmt = stmt.where(ReviewComment.resolved.is_(True))
        elif resolved == "false":
            stmt = stmt.where(ReviewComment.resolved.is_(False))
        rows = (
            (await self.session.execute(stmt.order_by(ReviewComment.id.desc()).limit(limit + 1)))
            .scalars()
            .all()
        )
        return rows[:limit], len(rows) > limit

    async def get_condition_in_project(
        self, project_id: int, condition_id: int
    ) -> LayerCondition | None:
        stmt = (
            select(LayerCondition)
            .join(SheetLayer, LayerCondition.layer_id == SheetLayer.id)
            .where(SheetLayer.project_id == project_id, LayerCondition.id == condition_id)
            .options(selectinload(LayerCondition.layer), selectinload(LayerCondition.cell_values))
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def has_layer_param_code(self, parameter_code: str) -> bool:
        result = await self.session.execute(
            select(Parameter.id).where(Parameter.code == parameter_code).limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def has_successor(self, source_project_id: int) -> bool:
        result = await self.session.execute(
            select(Project.id).where(Project.revision_of_id == source_project_id).limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def list_active_categories(self) -> list[ParameterCategory]:
        result = await self.session.execute(
            select(ParameterCategory)
            .where(ParameterCategory.is_active.is_(True))
            .order_by(ParameterCategory.sort_order, ParameterCategory.code)
        )
        return list(result.scalars().all())

    async def list_choice_sets(self) -> list[ChoiceSet]:
        result = await self.session.execute(
            select(ChoiceSet).options(selectinload(ChoiceSet.options)).order_by(ChoiceSet.code)
        )
        return list(result.scalars().all())

    async def clear_lock(self, project_id: int) -> None:
        existing = await self.session.get(EditLock, project_id)
        if existing is not None:
            await self.session.delete(existing)
