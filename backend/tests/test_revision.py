"""
Tests for revision feature (SPEC-002 M2).

Tests cover:
- Creating a revision from an approved project
- Archiving the original project
- Incrementing revision number
- Copying layers with correct backbone_conditions
- Error handling for non-approved projects and active projects
- Preventing edits to archived projects
- Version history retrieval
"""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Project, ProjectLayer
from app.services.project_service import (
    create_project,
    get_project_detail,
    revise_project,
    get_product_revisions,
)
from app.services.condition_service import bulk_save_conditions
from app.schemas.project import BulkSaveRequest, LayerConditions


class TestReviseProject:
    """Test revision creation functionality."""

    @pytest.mark.asyncio
    async def test_revise_approved_project_creates_new_draft(self, db_session: AsyncSession, seed_test_data):
        """Revising an approved project creates a new draft with revision+1."""
        # Create and approve a project
        project = await create_project(
            db_session,
            product_id=seed_test_data["target"].id,
            backbone_product_id=seed_test_data["backbone"].id,
            created_by=seed_test_data["user"].id,
        )
        project.status = "approved"
        project.approved_at = project.updated_at
        await db_session.commit()

        # Revise it
        new_project = await revise_project(db_session, project.id, revision_reason="Test revision")

        assert new_project.status == "draft"
        assert new_project.revision == 2
        assert new_project.is_latest is True
        assert new_project.parent_project_id == project.id
        assert new_project.product_id == project.product_id

    @pytest.mark.asyncio
    async def test_revise_sets_original_to_archived(self, db_session: AsyncSession, seed_test_data):
        """After revision, original project becomes archived and is_latest=False."""
        # Create and approve a project
        project = await create_project(
            db_session,
            product_id=seed_test_data["target"].id,
            backbone_product_id=seed_test_data["backbone"].id,
            created_by=seed_test_data["user"].id,
        )
        project.status = "approved"
        await db_session.commit()

        # Revise it
        await revise_project(db_session, project.id)

        # Refresh original
        await db_session.refresh(project)

        assert project.status == "archived"
        assert project.is_latest is False

    @pytest.mark.asyncio
    async def test_revise_increments_revision_number(self, db_session: AsyncSession, seed_test_data):
        """Revision number increments correctly across multiple revisions."""
        # Create and approve first project (revision 1)
        project_v1 = await create_project(
            db_session,
            product_id=seed_test_data["target"].id,
            backbone_product_id=seed_test_data["backbone"].id,
            created_by=seed_test_data["user"].id,
        )
        project_v1.status = "approved"
        await db_session.commit()

        assert project_v1.revision == 1

        # Create revision 2
        project_v2 = await revise_project(db_session, project_v1.id)
        assert project_v2.revision == 2

        # Approve v2 and create v3
        project_v2.status = "approved"
        await db_session.commit()

        project_v3 = await revise_project(db_session, project_v2.id)
        assert project_v3.revision == 3

    @pytest.mark.asyncio
    async def test_revise_copies_layers_with_correct_backbone_conditions(
        self, db_session: AsyncSession, seed_test_data
    ):
        """New revision's backbone_conditions should equal original's conditions."""
        # Create project
        project = await create_project(
            db_session,
            product_id=seed_test_data["target"].id,
            backbone_product_id=seed_test_data["backbone"].id,
            created_by=seed_test_data["user"].id,
        )

        # Modify some conditions
        layers = project.layers[:1]  # Get first layer
        modified_conditions = {
            "SP_SPIN1_SPEED_rpm": 3000,  # Different from backbone
            "SC_EXPOSE_ENERGY_mJ": 50.0,
        }
        layers[0].conditions = modified_conditions
        await db_session.commit()
        await db_session.refresh(project)

        # Approve
        project.status = "approved"
        await db_session.commit()

        # Revise
        new_project = await revise_project(db_session, project.id)

        # Check that new project's backbone_conditions equals original's conditions
        original_layer = project.layers[0]
        new_layer = next(
            (layer for layer in new_project.layers if layer.layer_id == original_layer.layer_id),
            None
        )

        assert new_layer is not None
        # Conditions should be copied
        assert new_layer.conditions == original_layer.conditions
        # Important: backbone_conditions should be set to the approved conditions
        assert new_layer.backbone_conditions == original_layer.conditions
        # Not the original's backbone_conditions
        assert new_layer.backbone_conditions != original_layer.backbone_conditions

    @pytest.mark.asyncio
    async def test_revise_non_approved_project_returns_error(self, db_session: AsyncSession, seed_test_data):
        """Cannot revise a draft project."""
        project = await create_project(
            db_session,
            product_id=seed_test_data["target"].id,
            backbone_product_id=seed_test_data["backbone"].id,
            created_by=seed_test_data["user"].id,
        )

        # Project is draft by default
        assert project.status == "draft"

        # Try to revise
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await revise_project(db_session, project.id)

        assert exc_info.value.status_code == 400
        assert "approved" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_revise_with_existing_active_project_returns_error(
        self, db_session: AsyncSession, seed_test_data
    ):
        """Cannot revise if draft/review project already exists for same product."""
        # Create and approve first project (v1)
        project_v1 = await create_project(
            db_session,
            product_id=seed_test_data["target"].id,
            backbone_product_id=seed_test_data["backbone"].id,
            created_by=seed_test_data["user"].id,
        )
        project_v1.status = "approved"
        await db_session.commit()

        # Revise it (creates draft v2, v1 becomes archived)
        project_v2 = await revise_project(db_session, project_v1.id)
        assert project_v2.status == "draft"

        # Now try to create another revision while v2 (draft) exists
        # This should fail because there's already an active draft
        from fastapi import HTTPException

        # Re-approve v1 for testing (normally wouldn't happen)
        await db_session.refresh(project_v1)
        project_v1.status = "approved"
        await db_session.commit()

        with pytest.raises(HTTPException) as exc_info:
            await revise_project(db_session, project_v1.id)

        assert exc_info.value.status_code == 409
        assert "active project" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_archived_project_cannot_be_saved(self, db_session: AsyncSession, seed_test_data):
        """bulk_save on archived project returns 400 error."""
        # Create and approve a project
        project = await create_project(
            db_session,
            product_id=seed_test_data["target"].id,
            backbone_product_id=seed_test_data["backbone"].id,
            created_by=seed_test_data["user"].id,
        )

        # Get layer ID and updated_at before archiving
        result = await db_session.execute(
            select(ProjectLayer).where(ProjectLayer.project_id == project.id).limit(1)
        )
        first_layer = result.scalars().first()
        layer_id = first_layer.id
        original_updated_at = project.updated_at

        project.status = "approved"
        await db_session.commit()

        # Revise it (original becomes archived)
        await revise_project(db_session, project.id)

        # Verify archived status by re-querying
        result = await db_session.execute(
            select(Project).where(Project.id == project.id)
        )
        archived_project = result.scalars().first()
        assert archived_project.status == "archived"

        # Try to save conditions to archived project
        request = BulkSaveRequest(
            layers=[
                LayerConditions(
                    project_layer_id=layer_id,
                    conditions={"SP_SPIN1_SPEED_rpm": 9999}
                )
            ],
            updated_by=seed_test_data["user"].id,
            expected_updated_at=original_updated_at,
        )

        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await bulk_save_conditions(db_session, project.id, request)

        assert exc_info.value.status_code == 400
        assert "draft" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_version_history_returns_all_revisions(self, db_session: AsyncSession, seed_test_data):
        """get_product_revisions returns all versions ordered by revision DESC."""
        # Create initial project (v1)
        project_v1 = await create_project(
            db_session,
            product_id=seed_test_data["target"].id,
            backbone_product_id=seed_test_data["backbone"].id,
            created_by=seed_test_data["user"].id,
        )
        project_v1.status = "approved"
        await db_session.commit()

        # Create v2
        project_v2 = await revise_project(db_session, project_v1.id)
        project_v2.status = "approved"
        await db_session.commit()

        # Create v3
        project_v3 = await revise_project(db_session, project_v2.id)

        # Get version history
        history = await get_product_revisions(db_session, seed_test_data["target"].id)

        assert len(history) == 3
        # Should be ordered by revision DESC
        assert history[0].revision == 3
        assert history[1].revision == 2
        assert history[2].revision == 1

        # Latest should be v3
        assert history[0].is_latest is True
        assert history[1].is_latest is False
        assert history[2].is_latest is False

        # Statuses
        assert history[0].status == "draft"
        assert history[1].status == "archived"
        assert history[2].status == "archived"
