"""
Tests for get_cell_history() service (TDD - new function).
Covers: multiple changes, no changes, invalid project_layer_id, missing params, 404.
"""
import pytest
from fastapi import HTTPException

from app.services.project.service import create_project, get_project_detail
from app.services.condition_service import bulk_save_conditions
from app.services import change_log_service
from app.schemas.project import BulkSaveRequest, LayerConditions


@pytest.mark.asyncio
class TestCellHistory:
    async def _create_project_with_changes(self, db_session, seed_test_data):
        """Helper: create a project and save conditions to generate change_log entries.

        Returns (project_id, data, layer_a_id) where layer_a is the first layer.
        We capture IDs before bulk_save_conditions commits the session (which expires objects).
        """
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )
        layers_sorted = sorted(project.layers, key=lambda x: x.sort_order)

        # Capture IDs and updated_at BEFORE bulk save commits
        layer_a = layers_sorted[0]
        layer_a_id = layer_a.id
        layer_a_conditions = dict(layer_a.conditions)
        project_id = project.id
        project_updated_at = project.updated_at

        save_req = BulkSaveRequest(
            layers=[
                LayerConditions(
                    project_layer_id=layer_a_id,
                    conditions={"SP_SPIN1_SPEED_rpm": 3000, "SC_EXPOSE_ENERGY_mJ": 40.0},
                )
            ],
            updated_by=data["user"].id,
            expected_updated_at=project_updated_at,
        )
        await bulk_save_conditions(db_session, project_id, save_req)
        return project_id, data, layer_a_id

    async def test_cell_with_multiple_changes_returns_history(self, db_session, seed_test_data):
        """A cell with change_log entries returns them in DESC order."""
        project_id, data, layer_a_id = await self._create_project_with_changes(db_session, seed_test_data)

        result = await change_log_service.get_cell_history(
            db_session, project_id,
            project_layer_id=layer_a_id,
            column_name="SP_SPIN1_SPEED_rpm",
        )
        assert result.total > 0
        assert len(result.items) == result.total
        assert result.project_layer_id == layer_a_id
        assert result.column_name == "SP_SPIN1_SPEED_rpm"

    async def test_cell_history_ordered_by_changed_at_desc(self, db_session, seed_test_data):
        """Cell history items are ordered newest first."""
        project_id, data, layer_a_id = await self._create_project_with_changes(db_session, seed_test_data)

        # Re-fetch project to get fresh updated_at for second save
        proj_refreshed = await get_project_detail(db_session, project_id)
        save_req2 = BulkSaveRequest(
            layers=[
                LayerConditions(
                    project_layer_id=layer_a_id,
                    conditions={"SP_SPIN1_SPEED_rpm": 4000},
                )
            ],
            updated_by=data["user"].id,
            expected_updated_at=proj_refreshed.updated_at,
        )
        await bulk_save_conditions(db_session, project_id, save_req2)

        result = await change_log_service.get_cell_history(
            db_session, project_id,
            project_layer_id=layer_a_id,
            column_name="SP_SPIN1_SPEED_rpm",
        )
        timestamps = [item.changed_at for item in result.items]
        assert timestamps == sorted(timestamps, reverse=True)

    async def test_cell_with_no_changes_returns_empty(self, db_session, seed_test_data):
        """A cell that was never changed returns empty items with total=0."""
        project_id, data, layer_a_id = await self._create_project_with_changes(db_session, seed_test_data)

        result = await change_log_service.get_cell_history(
            db_session, project_id,
            project_layer_id=layer_a_id,
            # Use a column name that does not exist in backbone or was never touched
            column_name="NONEXISTENT_COLUMN_NEVER_CHANGED",
        )
        assert result.total == 0
        assert result.items == []

    async def test_cell_history_includes_layer_name(self, db_session, seed_test_data):
        """CellHistoryResponse includes the correct layer_name."""
        project_id, data, layer_a_id = await self._create_project_with_changes(db_session, seed_test_data)

        result = await change_log_service.get_cell_history(
            db_session, project_id,
            project_layer_id=layer_a_id,
            column_name="SP_SPIN1_SPEED_rpm",
        )
        assert result.layer_name == "LAYER_A"

    async def test_cell_history_items_have_user_name(self, db_session, seed_test_data):
        """Each history item has changed_by_name resolved."""
        project_id, data, layer_a_id = await self._create_project_with_changes(db_session, seed_test_data)

        result = await change_log_service.get_cell_history(
            db_session, project_id,
            project_layer_id=layer_a_id,
            column_name="SP_SPIN1_SPEED_rpm",
        )
        for item in result.items:
            assert item.changed_by_name is not None
            assert len(item.changed_by_name) > 0

    async def test_invalid_project_layer_id_raises_404(self, db_session, seed_test_data):
        """project_layer_id not belonging to the project raises 404."""
        project_id, data, layer_a_id = await self._create_project_with_changes(db_session, seed_test_data)

        with pytest.raises(HTTPException) as exc_info:
            await change_log_service.get_cell_history(
                db_session, project_id,
                project_layer_id=999999,  # does not belong to project
                column_name="SP_SPIN1_SPEED_rpm",
            )
        assert exc_info.value.status_code == 404

    async def test_project_not_found_raises_404(self, db_session, seed_test_data):
        """Non-existent project_id raises 404."""
        with pytest.raises(HTTPException) as exc_info:
            await change_log_service.get_cell_history(
                db_session, 999999,
                project_layer_id=1,
                column_name="SP_SPIN1_SPEED_rpm",
            )
        assert exc_info.value.status_code == 404

    async def test_project_layer_from_other_project_raises_404(self, db_session, seed_test_data):
        """project_layer_id from a different project raises 404."""
        data = seed_test_data

        # Create first project for the target product
        project1 = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )
        project1_id = project1.id

        # Transition project1 to approved so we can create a second project for target
        # Instead use partial product to create a separate project
        project2 = await create_project(
            db_session, data["partial"].id, data["backbone"].id, data["user"].id,
        )
        layers_p2 = sorted(project2.layers, key=lambda x: x.sort_order)
        pl_from_p2_id = layers_p2[0].id

        with pytest.raises(HTTPException) as exc_info:
            await change_log_service.get_cell_history(
                db_session, project1_id,
                project_layer_id=pl_from_p2_id,  # belongs to project2, not project1
                column_name="SP_SPIN1_SPEED_rpm",
            )
        assert exc_info.value.status_code == 404
