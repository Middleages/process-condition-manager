"""
Repository layer for backbone-related queries.

Encapsulates all queries needed to identify and load backbone data from
Approved projects. An "Approved" project with is_latest=True is the new
source of truth for backbone conditions. Backbone eligibility is determined dynamically.

All heavy query logic is centralized here. Business logic (validation,
error messages) remains in the calling service.
"""
from fastapi import HTTPException
from sqlalchemy import select, and_, distinct
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import Project, ProjectLayer
from app.models.product import Product


class BackboneRepository:
    """Data access layer for backbone-related queries using Approved projects."""

    @staticmethod
    async def get_approved_project_for_product(
        db: AsyncSession,
        product_id: int,
    ) -> Project | None:
        """Find the latest Approved project for a product.

        An Approved project with is_latest=True is the canonical backbone
        source for the given product.

        Args:
            db: Async database session
            product_id: Product to find the Approved project for

        Returns:
            Project instance with project_layers eagerly loaded, or None
        """
        result = await db.execute(
            select(Project)
            .options(selectinload(Project.layers))
            .where(
                and_(
                    Project.product_id == product_id,
                    Project.status == "approved",
                    Project.is_latest == True,  # noqa: E712
                )
            )
        )
        return result.scalars().first()

    @staticmethod
    async def get_backbone_layer_map(
        db: AsyncSession,
        product_id: int,
    ) -> dict[str, dict]:
        """Return {layer_id: conditions} from the Approved project for a product.

        Args:
            db: Async database session
            product_id: Product whose Approved project's layers to retrieve

        Returns:
            Dict mapping layer_id (str, e.g. "1.0") to the conditions dict
            from the Approved project. Returns empty dict if no Approved project exists.
        """
        approved_project = await BackboneRepository.get_approved_project_for_product(
            db, product_id
        )
        if approved_project is None:
            return {}

        return {pl.layer_id: pl.conditions for pl in approved_project.layers}

    @staticmethod
    async def validate_backbone_source(
        db: AsyncSession,
        product_id: int,
    ) -> Project:
        """Validate that a product has an Approved project usable as backbone.

        Combines get + validation into one call. Raises HTTPException(400)
        if no Approved project exists for the product.

        Args:
            db: Async database session
            product_id: Product to validate as backbone source

        Returns:
            The Approved Project instance with layers eagerly loaded

        Raises:
            HTTPException: 400 if no Approved project found for the product
        """
        approved_project = await BackboneRepository.get_approved_project_for_product(
            db, product_id
        )
        if approved_project is None:
            result = await db.execute(
                select(Product).where(Product.id == product_id)
            )
            product = result.scalars().first()
            product_name = product.product_name if product else f"id={product_id}"
            raise HTTPException(
                status_code=400,
                detail=f"No approved project found for product '{product_name}'. "
                       "A product must have an Approved project to be used as backbone.",
            )
        return approved_project

    @staticmethod
    async def list_backbone_products(
        db: AsyncSession,
        line_id: int | None = None,
    ) -> list[dict]:
        """List products that have an Approved project (usable as backbone).

        Returns product info including the revision number and approved_at
        from the Approved project.

        Args:
            db: Async database session
            line_id: Optional filter to restrict results to a specific line

        Returns:
            List of dicts with product info + revision + approved_at
        """
        query = (
            select(
                Product,
                Project.revision,
                Project.approved_at,
            )
            .join(Project, Project.product_id == Product.id)
            .where(
                and_(
                    Project.status == "approved",
                    Project.is_latest == True,  # noqa: E712
                )
            )
            .order_by(Product.product_name)
        )

        if line_id is not None:
            query = query.where(Product.line_id == line_id)

        result = await db.execute(query)
        rows = result.all()

        return [
            {
                "id": row.Product.id,
                "product_name": row.Product.product_name,
                "description": row.Product.description,
                "line_id": row.Product.line_id,
                "part_id": row.Product.part_id,
                "revision": row.revision,
                "approved_at": row.approved_at,
            }
            for row in rows
        ]

    @staticmethod
    async def get_backbone_layers(
        db: AsyncSession,
        product_id: int,
    ) -> list[ProjectLayer]:
        """Return the Approved project's project_layers for a product.

        Args:
            db: Async database session
            product_id: Product whose Approved project's layers to retrieve

        Returns:
            List of ProjectLayer instances from the Approved project,
            with layer relationship eagerly loaded. Empty list if no Approved project.
        """
        approved_project = await BackboneRepository.get_approved_project_for_product(
            db, product_id
        )
        if approved_project is None:
            return []

        # Re-query project layers (layer_name/step_seq are denormalized on ProjectLayer)
        result = await db.execute(
            select(ProjectLayer)
            .where(ProjectLayer.project_id == approved_project.id)
            .order_by(ProjectLayer.sort_order)
        )
        return list(result.scalars().all())
