import pytest
from fastapi import HTTPException

from app.services.project_service import create_project
from app.services.backbone_service import replace_layer_backbone, add_layer, delete_layer
from app.models import ChangeLog, ProjectLayer
from sqlalchemy import select


@pytest.mark.asyncio
class TestBackboneReplace:

    async def _create_draft_project(self, db_session, seed_data):
        """Helper: create a draft project from seed data."""
        project = await create_project(
            db_session,
            seed_data["target"].id,
            seed_data["backbone"].id,
            seed_data["user"].id,
        )
        return project

    async def test_replace_backbone_copies_conditions(self, db_session, seed_test_data):
        """Replacing backbone should copy source conditions."""
        project = await self._create_draft_project(db_session, seed_test_data)
        first_pl = sorted(project.layers, key=lambda pl: pl.sort_order)[0]

        # Modify conditions to be different
        first_pl.conditions = {"SP_SPIN1_SPEED_rpm": 9999}
        await db_session.flush()

        # Replace with backbone
        updated_pl, changed = await replace_layer_backbone(
            db_session,
            project.id,
            first_pl.id,
            source_product_id=seed_test_data["backbone"].id,
            source_layer_name=None,
            changed_by=seed_test_data["user"].id,
        )

        # Should have backbone conditions
        assert updated_pl.conditions == seed_test_data["bb_conditions"][0]
        assert updated_pl.backbone_conditions == seed_test_data["bb_conditions"][0]
        assert updated_pl.backbone_product_id == seed_test_data["backbone"].id
        assert changed > 0

    async def test_replace_backbone_creates_change_logs(self, db_session, seed_test_data):
        """Replacing backbone should create change_logs with type='backbone'."""
        project = await self._create_draft_project(db_session, seed_test_data)
        first_pl = sorted(project.layers, key=lambda pl: pl.sort_order)[0]

        # Modify one condition
        first_pl.conditions = {"SP_SPIN1_SPEED_rpm": 9999}
        await db_session.flush()

        await replace_layer_backbone(
            db_session,
            project.id,
            first_pl.id,
            source_product_id=seed_test_data["backbone"].id,
            source_layer_name=None,
            changed_by=seed_test_data["user"].id,
        )

        # Check change_logs
        result = await db_session.execute(
            select(ChangeLog).where(
                ChangeLog.project_layer_id == first_pl.id,
                ChangeLog.change_type == "backbone",
            )
        )
        logs = result.scalars().all()
        assert len(logs) > 0
        # All logs should be backbone type
        for log in logs:
            assert log.change_type == "backbone"

    async def test_replace_backbone_rejects_non_draft(self, db_session, seed_test_data):
        """Should reject backbone replacement for non-draft projects."""
        project = await self._create_draft_project(db_session, seed_test_data)
        project.status = "review"
        await db_session.flush()

        first_pl = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        with pytest.raises(HTTPException) as exc_info:
            await replace_layer_backbone(
                db_session,
                project.id,
                first_pl.id,
                source_product_id=seed_test_data["backbone"].id,
                source_layer_name=None,
                changed_by=seed_test_data["user"].id,
            )
        assert exc_info.value.status_code == 400

    async def test_replace_backbone_rejects_non_backbone_source(self, db_session, seed_test_data):
        """Should reject if source product is not a backbone."""
        project = await self._create_draft_project(db_session, seed_test_data)
        first_pl = sorted(project.layers, key=lambda pl: pl.sort_order)[0]

        with pytest.raises(HTTPException) as exc_info:
            await replace_layer_backbone(
                db_session,
                project.id,
                first_pl.id,
                source_product_id=seed_test_data["target"].id,
                source_layer_name=None,
                changed_by=seed_test_data["user"].id,
            )
        assert exc_info.value.status_code == 400

    async def test_replace_backbone_auto_matches_layer_name(self, db_session, seed_test_data):
        """Should auto-match by layer name when source_layer_name is None."""
        project = await self._create_draft_project(db_session, seed_test_data)
        # LAYER_A -> replace with backbone LAYER_A
        layer_a_pl = [pl for pl in project.layers if pl.layer.layer_name == "LAYER_A"][0]

        updated_pl, _ = await replace_layer_backbone(
            db_session,
            project.id,
            layer_a_pl.id,
            source_product_id=seed_test_data["backbone"].id,
            source_layer_name=None,  # auto-match
            changed_by=seed_test_data["user"].id,
        )

        # Should match LAYER_A from backbone
        assert updated_pl.conditions == seed_test_data["bb_conditions"][0]


@pytest.mark.asyncio
class TestLayerAdd:

    async def _create_draft_project(self, db_session, seed_data):
        """Helper: create a draft project with partial product (2 layers)."""
        project = await create_project(
            db_session,
            seed_data["partial"].id,
            seed_data["backbone"].id,
            seed_data["user"].id,
        )
        return project

    async def test_add_empty_layer(self, db_session, seed_test_data):
        """Adding a layer without source should create empty conditions."""
        project = await self._create_draft_project(db_session, seed_test_data)
        assert len(project.layers) == 2

        # Add LAYER_C which is not in partial product
        layer_c = seed_test_data["layers"][2]
        new_pl = await add_layer(
            db_session,
            project.id,
            layer_c.id,
            changed_by=seed_test_data["user"].id,
        )

        assert new_pl.layer_id == layer_c.id
        assert new_pl.conditions == {}
        assert new_pl.backbone_product_id is None

    async def test_add_layer_from_backbone(self, db_session, seed_test_data):
        """Adding a layer with source should copy backbone conditions."""
        project = await self._create_draft_project(db_session, seed_test_data)
        layer_c = seed_test_data["layers"][2]

        new_pl = await add_layer(
            db_session,
            project.id,
            layer_c.id,
            changed_by=seed_test_data["user"].id,
            source_product_id=seed_test_data["backbone"].id,
        )

        assert new_pl.conditions == seed_test_data["bb_conditions"][2]
        assert new_pl.backbone_conditions == seed_test_data["bb_conditions"][2]
        assert new_pl.backbone_product_id == seed_test_data["backbone"].id

    async def test_add_duplicate_layer_rejected(self, db_session, seed_test_data):
        """Adding an already-existing layer should return 409."""
        project = await self._create_draft_project(db_session, seed_test_data)
        existing_layer = seed_test_data["layers"][0]  # LAYER_A already exists

        with pytest.raises(HTTPException) as exc_info:
            await add_layer(
                db_session,
                project.id,
                existing_layer.id,
                changed_by=seed_test_data["user"].id,
            )
        assert exc_info.value.status_code == 409

    async def test_add_layer_rejects_non_draft(self, db_session, seed_test_data):
        """Should reject layer addition for non-draft projects."""
        project = await self._create_draft_project(db_session, seed_test_data)
        project.status = "approved"
        await db_session.flush()

        layer_c = seed_test_data["layers"][2]
        with pytest.raises(HTTPException) as exc_info:
            await add_layer(
                db_session,
                project.id,
                layer_c.id,
                changed_by=seed_test_data["user"].id,
            )
        assert exc_info.value.status_code == 400


@pytest.mark.asyncio
class TestLayerDelete:

    async def _create_draft_project(self, db_session, seed_data):
        project = await create_project(
            db_session,
            seed_data["target"].id,
            seed_data["backbone"].id,
            seed_data["user"].id,
        )
        return project

    async def test_delete_layer(self, db_session, seed_test_data):
        """Deleting a layer should remove it from the project."""
        project = await self._create_draft_project(db_session, seed_test_data)
        first_pl = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        pl_id = first_pl.id

        await delete_layer(db_session, project.id, pl_id)

        # Verify deleted
        result = await db_session.execute(
            select(ProjectLayer).where(ProjectLayer.id == pl_id)
        )
        assert result.scalars().first() is None

    async def test_delete_layer_rejects_non_draft(self, db_session, seed_test_data):
        """Should reject layer deletion for non-draft projects."""
        project = await self._create_draft_project(db_session, seed_test_data)
        project.status = "approved"
        await db_session.flush()

        first_pl = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        with pytest.raises(HTTPException) as exc_info:
            await delete_layer(db_session, project.id, first_pl.id)
        assert exc_info.value.status_code == 400

    async def test_delete_nonexistent_layer_returns_404(self, db_session, seed_test_data):
        """Deleting a non-existent layer should return 404."""
        project = await self._create_draft_project(db_session, seed_test_data)
        with pytest.raises(HTTPException) as exc_info:
            await delete_layer(db_session, project.id, 99999)
        assert exc_info.value.status_code == 404
