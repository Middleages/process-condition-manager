import pytest
from fastapi import HTTPException

from app.services.project_service import create_project, get_project_detail


@pytest.mark.asyncio
class TestBackboneCopy:

    async def test_create_project_copies_backbone_conditions(self, db_session, seed_test_data):
        """All 3 layers should have backbone conditions copied."""
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )

        assert project.status == "draft"
        assert len(project.layers) == 3

        # Verify each layer has the correct backbone conditions
        layers_sorted = sorted(project.layers, key=lambda pl: pl.sort_order)
        for i, pl in enumerate(layers_sorted):
            assert pl.conditions == data["bb_conditions"][i]
            assert pl.backbone_conditions == data["bb_conditions"][i]
            assert pl.backbone_product_id == data["backbone"].id

    async def test_create_project_backbone_conditions_are_independent_copy(self, db_session, seed_test_data):
        """Modifying conditions should not affect backbone_conditions."""
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )

        # Modify conditions on first layer
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        first_layer.conditions["SP_SPIN1_SPEED_rpm"] = 9999
        await db_session.flush()

        # Reload and check backbone_conditions unchanged
        project = await get_project_detail(db_session, project.id)
        first_layer = sorted(project.layers, key=lambda pl: pl.sort_order)[0]
        assert first_layer.conditions["SP_SPIN1_SPEED_rpm"] == 9999
        assert first_layer.backbone_conditions["SP_SPIN1_SPEED_rpm"] == 2000

    async def test_create_project_rejects_non_backbone_product(self, db_session, seed_test_data):
        """Using a non-backbone as backbone should return 400."""
        data = seed_test_data
        with pytest.raises(HTTPException) as exc_info:
            await create_project(
                db_session, data["target"].id, data["target"].id, data["user"].id,
            )
        assert exc_info.value.status_code == 400

    async def test_create_project_prevents_duplicate_active_project(self, db_session, seed_test_data):
        """Creating a second draft project for same product should return 409."""
        data = seed_test_data
        await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )
        with pytest.raises(HTTPException) as exc_info:
            await create_project(
                db_session, data["target"].id, data["backbone"].id, data["user"].id,
            )
        assert exc_info.value.status_code == 409

    async def test_create_project_sets_correct_sort_order(self, db_session, seed_test_data):
        """project_layers.sort_order should match the source layers.sort_order."""
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )

        expected_sort_orders = {layer.sort_order for layer in data["layers"]}
        actual_sort_orders = {pl.sort_order for pl in project.layers}
        assert actual_sort_orders == expected_sort_orders

    async def test_create_project_with_partial_layer_overlap(self, db_session, seed_test_data):
        """Product with only 2 layers should get 2 project_layers, all with backbone conditions."""
        data = seed_test_data
        project = await create_project(
            db_session, data["partial"].id, data["backbone"].id, data["user"].id,
        )

        assert len(project.layers) == 2
        # All layers have matching backbone, so all should have conditions
        for pl in project.layers:
            assert pl.conditions != {}
            assert pl.backbone_product_id == data["backbone"].id

    async def test_create_project_nonexistent_product_returns_404(self, db_session, seed_test_data):
        """Using a nonexistent product_id should return 404."""
        data = seed_test_data
        with pytest.raises(HTTPException) as exc_info:
            await create_project(db_session, 9999, data["backbone"].id, data["user"].id)
        assert exc_info.value.status_code == 404

    async def test_create_project_nonexistent_backbone_returns_404(self, db_session, seed_test_data):
        """Using a nonexistent backbone_product_id should return 404."""
        data = seed_test_data
        with pytest.raises(HTTPException) as exc_info:
            await create_project(db_session, data["target"].id, 9999, data["user"].id)
        assert exc_info.value.status_code == 404
