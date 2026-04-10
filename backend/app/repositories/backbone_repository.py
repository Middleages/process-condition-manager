"""
Repository layer for backbone-related queries.

Encapsulates all queries needed to identify and load backbone data from
Approved projects. An "Approved" project with is_latest=True is the new
source of truth for backbone conditions. Backbone eligibility is determined dynamically.

All heavy query logic is centralized here. Business logic (validation,
error messages) remains in the calling service.
"""
from fastapi import HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import Project, ProjectLayer


class BackboneRepository:
    """Data access layer for backbone-related queries using Approved projects."""

    @staticmethod
    async def get_approved_condition(
        db: AsyncSession,
        condition_id: int,
    ) -> Project | None:
        """Find a specific approved/latest process-condition by id."""
        result = await db.execute(
            select(Project)
            .options(selectinload(Project.layers))
            .where(
                and_(
                    Project.id == condition_id,
                    Project.status == "approved",
                    Project.is_latest == True,  # noqa: E712
                )
            )
        )
        return result.scalars().first()

    @staticmethod
    async def get_backbone_layer_map(
        db: AsyncSession,
        condition_id: int,
    ) -> dict[str, dict]:
        """Return {layer_id: conditions} from an approved backbone condition.

        Args:
            db: Async database session
            condition_id: Approved backbone process-condition ID.

        Returns:
            Dict mapping layer_id to conditions dict.
        """
        approved_project = await BackboneRepository.get_approved_condition(
            db, condition_id
        )
        if approved_project is None:
            return {}

        return {pl.layer_id: pl.conditions for pl in approved_project.layers}

    @staticmethod
    async def validate_backbone_source(
        db: AsyncSession,
        condition_id: int,
    ) -> Project:
        """Validate that an approved/latest process-condition can be used as backbone.

        Combines get + validation into one call. Raises HTTPException(400)
        if no Approved project exists for the product.

        Args:
            db: Async database session
            condition_id: process-condition id to validate as backbone source

        Returns:
            The approved/latest Project instance with layers eagerly loaded

        Raises:
            HTTPException: 400 if no Approved project found for the product
        """
        approved_project = await BackboneRepository.get_approved_condition(
            db, condition_id
        )
        if approved_project is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"No approved/latest process-condition found for backbone_condition_id={condition_id}."
                ),
            )
        return approved_project

    @staticmethod
    async def list_backbone_conditions(
        db: AsyncSession,
        line_id: int | None = None,
    ) -> list[dict]:
        """List approved/latest process-conditions eligible as backbone."""
        query = (
            select(Project)
            .where(
                and_(
                    Project.status == "approved",
                    Project.is_latest == True,  # noqa: E712
                )
            )
            .order_by(Project.updated_at.desc())
        )

        if line_id is not None:
            query = query.where(Project.line_id == line_id)

        result = await db.execute(query)
        rows = result.scalars().all()

        return [
            {
                "id": row.id,
                "line_id": row.line_id,
                "process_id": row.process,
                "part_id": row.part_id,
                "revision": row.revision,
                "approved_at": row.approved_at,
            }
            for row in rows
            if row.line_id is not None and row.process and row.part_id
        ]

    @staticmethod
    async def get_backbone_layers_by_condition(
        db: AsyncSession,
        condition_id: int,
    ) -> list[ProjectLayer]:
        """Return project_layers from the selected approved/latest backbone condition."""
        approved_project = await BackboneRepository.get_approved_condition(db, condition_id)
        if approved_project is None:
            return []
        result = await db.execute(
            select(ProjectLayer)
            .where(ProjectLayer.project_id == approved_project.id)
            .order_by(ProjectLayer.sort_order)
        )
        return list(result.scalars().all())
