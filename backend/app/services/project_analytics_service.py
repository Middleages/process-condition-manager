"""
Project analytics and reporting service.

Handles change summaries and version history.
"""
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models import Product, Project, ProjectLayer
from app.repositories import ChangeLogRepository
from app.services import validation_service


async def get_change_summary(db: AsyncSession, project_id: int) -> dict:
    """
    Get change summary statistics for a project.

    Returns:
        Dictionary with:
        - validation_error_count
        - changed_layers_count
        - total_layers_count
        - changed_cells_count
        - backbone_replacements_count
        - recipe_applications_count
    """
    # Get validation error count
    validation_result = await validation_service.validate_project(db, project_id)
    validation_error_count = validation_result.error_count

    # Get total layers count
    total_layers_result = await db.execute(
        select(func.count(ProjectLayer.id))
        .where(ProjectLayer.project_id == project_id)
    )
    total_layers_count = total_layers_result.scalar() or 0

    # Get project layer IDs
    project_layers_result = await db.execute(
        select(ProjectLayer.id)
        .where(ProjectLayer.project_id == project_id)
    )
    project_layer_ids = [row[0] for row in project_layers_result.fetchall()]

    if not project_layer_ids:
        return {
            "validation_error_count": validation_error_count,
            "changed_layers_count": 0,
            "total_layers_count": total_layers_count,
            "changed_cells_count": 0,
            "backbone_replacements_count": 0,
            "recipe_applications_count": 0,
        }

    # Fetch all change stats in a single aggregation query
    stats = await ChangeLogRepository.fetch_change_summary_stats(db, project_layer_ids)

    return {
        "validation_error_count": validation_error_count,
        "total_layers_count": total_layers_count,
        **stats,
    }


async def get_version_history(
    db: AsyncSession,
    project_id: int,
):
    """Get version history for all projects sharing the same product as the given project."""
    from app.schemas.project import VersionItem, VersionHistoryResponse

    # Get project with product relationship
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    # Get product info
    product = await db.get(Product, project.product_id)
    if not product:
        raise HTTPException(404, "Product not found")

    # Query all projects with same product_id, ordered by revision DESC
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.creator))
        .where(Project.product_id == project.product_id)
        .order_by(Project.revision.desc())
    )
    projects = list(result.scalars().all())

    versions = [
        VersionItem(
            project_id=p.id,
            revision=p.revision,
            status=p.status,
            is_latest=p.is_latest,
            is_current=(p.id == project_id),
            created_by_name=p.creator.display_name if p.creator else None,
            created_at=p.created_at,
            revision_reason=p.revision_reason,
        )
        for p in projects
    ]

    return VersionHistoryResponse(
        product_id=product.id,
        product_name=product.product_name,
        current_project_id=project_id,
        versions=versions,
    )
