"""
Tests for app.services.change_log_service.list_change_logs.

Covers:
- Returns logs ordered by changed_at descending
- Filter by layer_id
- Filter by column_name
- Combined layer_id + column_name filter
- Pagination (limit and offset)
- Empty result when no logs exist
- Nonexistent project raises 404
"""

from datetime import datetime, timezone, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import ChangeLog
from app.services.project_service import create_project
from app.services.condition_service import bulk_save_conditions
from app.services.change_log_service import list_change_logs
from app.schemas.project import BulkSaveRequest, LayerConditions


@pytest.mark.asyncio
class TestGetChangeLogs:
    """Tests for list_change_logs service function."""

    async def _create_project_with_changes(self, db_session, seed_test_data):
        """
        Helper: create a draft project, then apply multiple edits to
        generate change_log entries across layers and columns.

        Returns (project, data, layers_sorted).
        """
        from app.services.project_service import get_project_detail

        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )
        layers_sorted = sorted(project.layers, key=lambda pl: pl.sort_order)
        layer_a, layer_b, layer_c = layers_sorted

        # --- First bulk save: change LAYER_A and LAYER_B ---
        request1 = BulkSaveRequest(
            layers=[
                LayerConditions(
                    project_layer_id=layer_a.id,
                    conditions={**layer_a.conditions, "SP_SPIN1_SPEED_rpm": 3000},
                ),
                LayerConditions(
                    project_layer_id=layer_b.id,
                    conditions={**layer_b.conditions, "SC_EXPOSE_ENERGY_mJ": 50.0},
                ),
            ],
            updated_by=data["user"].id,
            expected_updated_at=project.updated_at,
        )
        result1 = await bulk_save_conditions(db_session, project.id, request1)
        assert result1.success is True

        # Reload project with eager loading to get fresh updated_at and maintain relationships
        project = await get_project_detail(db_session, project.id)
        layers_sorted = sorted(project.layers, key=lambda pl: pl.sort_order)
        layer_a, layer_b, layer_c = layers_sorted

        # --- Second bulk save: change LAYER_A again + LAYER_C ---
        request2 = BulkSaveRequest(
            layers=[
                LayerConditions(
                    project_layer_id=layer_a.id,
                    conditions={**layer_a.conditions, "SP_SPIN1_SPEED_rpm": 4000, "SC_EXPOSE_ENERGY_mJ": 40.0},
                ),
                LayerConditions(
                    project_layer_id=layer_c.id,
                    conditions={**layer_c.conditions, "SP_SPIN1_SPEED_rpm": 2200},
                ),
            ],
            updated_by=data["user"].id,
            expected_updated_at=project.updated_at,
        )
        result2 = await bulk_save_conditions(db_session, project.id, request2)
        assert result2.success is True

        # Reload layers (layer_name is denormalized on ProjectLayer)
        from app.models import ProjectLayer
        layers_result = await db_session.execute(
            select(ProjectLayer)
            .where(ProjectLayer.project_id == project.id)
            .order_by(ProjectLayer.sort_order)
        )
        layers_sorted = layers_result.scalars().all()

        return project, data, layers_sorted

    # ------------------------------------------------------------------
    # Basic retrieval & ordering
    # ------------------------------------------------------------------

    async def test_returns_logs_ordered_by_changed_at_desc(self, db_session, seed_test_data):
        """Change logs should be returned newest first."""
        project, data, layers = await self._create_project_with_changes(
            db_session, seed_test_data,
        )

        result = await list_change_logs(db_session, project.id)

        assert result.total > 0
        assert len(result.items) == result.total

        # Verify descending order
        for i in range(len(result.items) - 1):
            assert result.items[i].changed_at >= result.items[i + 1].changed_at

    async def test_change_log_response_fields(self, db_session, seed_test_data):
        """Each item should have all expected fields populated."""
        project, data, layers = await self._create_project_with_changes(
            db_session, seed_test_data,
        )

        result = await list_change_logs(db_session, project.id)
        assert result.total > 0

        item = result.items[0]
        assert item.id is not None
        assert item.project_layer_id is not None
        assert item.layer_name != ""
        assert item.column_name != ""
        assert item.change_type == "manual"
        assert item.changed_by == data["user"].id
        assert item.changed_by_name == "Test User"
        assert item.changed_at is not None

    # ------------------------------------------------------------------
    # Filter by layer_id
    # ------------------------------------------------------------------

    async def test_filter_by_layer_id(self, db_session, seed_test_data):
        """Filtering by layer_id should return only logs for that layer."""
        project, data, layers = await self._create_project_with_changes(
            db_session, seed_test_data,
        )
        layer_a = layers[0]

        # Get layer_id for LAYER_A
        layer_a_layer_id = layer_a.layer_id

        result = await list_change_logs(
            db_session, project.id, layer_id=layer_a_layer_id,
        )

        assert result.total > 0
        for item in result.items:
            assert item.layer_name == "LAYER_A"

    async def test_filter_by_layer_id_excludes_other_layers(self, db_session, seed_test_data):
        """Filtering by LAYER_B's layer_id should exclude LAYER_A and LAYER_C logs."""
        project, data, layers = await self._create_project_with_changes(
            db_session, seed_test_data,
        )
        layer_b = layers[1]

        result = await list_change_logs(
            db_session, project.id, layer_id=layer_b.layer_id,
        )

        assert result.total > 0
        layer_names = {item.layer_name for item in result.items}
        assert layer_names == {"LAYER_B"}

    # ------------------------------------------------------------------
    # Filter by column_name
    # ------------------------------------------------------------------

    async def test_filter_by_column_name(self, db_session, seed_test_data):
        """Filtering by column_name should return only logs for that column."""
        project, data, layers = await self._create_project_with_changes(
            db_session, seed_test_data,
        )

        result = await list_change_logs(
            db_session, project.id, column_name="SP_SPIN1_SPEED_rpm",
        )

        assert result.total > 0
        for item in result.items:
            assert item.column_name == "SP_SPIN1_SPEED_rpm"

    async def test_filter_by_column_name_excludes_other_columns(self, db_session, seed_test_data):
        """Filtering by SC_EXPOSE_ENERGY_mJ should not include SP_SPIN1_SPEED_rpm logs."""
        project, data, layers = await self._create_project_with_changes(
            db_session, seed_test_data,
        )

        result = await list_change_logs(
            db_session, project.id, column_name="SC_EXPOSE_ENERGY_mJ",
        )

        assert result.total > 0
        column_names = {item.column_name for item in result.items}
        assert column_names == {"SC_EXPOSE_ENERGY_mJ"}

    # ------------------------------------------------------------------
    # Combined filters
    # ------------------------------------------------------------------

    async def test_filter_by_layer_id_and_column_name(self, db_session, seed_test_data):
        """Combining layer_id and column_name should narrow results."""
        project, data, layers = await self._create_project_with_changes(
            db_session, seed_test_data,
        )
        layer_a = layers[0]

        result = await list_change_logs(
            db_session, project.id,
            layer_id=layer_a.layer_id,
            column_name="SP_SPIN1_SPEED_rpm",
        )

        assert result.total > 0
        for item in result.items:
            assert item.layer_name == "LAYER_A"
            assert item.column_name == "SP_SPIN1_SPEED_rpm"

    # ------------------------------------------------------------------
    # Pagination
    # ------------------------------------------------------------------

    async def test_pagination_limit(self, db_session, seed_test_data):
        """Limiting to 2 items should return at most 2, with total reflecting all."""
        project, data, layers = await self._create_project_with_changes(
            db_session, seed_test_data,
        )

        result = await list_change_logs(db_session, project.id, limit=2, page=1)

        assert len(result.items) <= 2
        # total should still reflect the full count
        assert result.total >= len(result.items)

    async def test_pagination_offset(self, db_session, seed_test_data):
        """Offset should skip the first N results."""
        project, data, layers = await self._create_project_with_changes(
            db_session, seed_test_data,
        )

        page1_result = await list_change_logs(db_session, project.id, limit=1, page=1)
        page2_result = await list_change_logs(db_session, project.id, limit=1, page=2)

        # Page 2 should return a different item than page 1
        if page1_result.total > 1:
            assert len(page2_result.items) == 1
            assert page2_result.items[0].id != page1_result.items[0].id

    # ------------------------------------------------------------------
    # Empty / edge cases
    # ------------------------------------------------------------------

    async def test_empty_logs_when_no_changes(self, db_session, seed_test_data):
        """A freshly created project with no edits should have zero change_logs."""
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )

        result = await list_change_logs(db_session, project.id)

        assert result.total == 0
        assert result.items == []

    async def test_filter_nonexistent_layer_returns_empty(self, db_session, seed_test_data):
        """Filtering by a layer_id with no matching project_layers returns empty."""
        project, data, layers = await self._create_project_with_changes(
            db_session, seed_test_data,
        )

        result = await list_change_logs(
            db_session, project.id, layer_id="99999",
        )

        assert result.total == 0
        assert result.items == []

    async def test_filter_nonexistent_column_name_returns_empty(self, db_session, seed_test_data):
        """Filtering by a column_name that has never been changed returns empty."""
        project, data, layers = await self._create_project_with_changes(
            db_session, seed_test_data,
        )

        result = await list_change_logs(
            db_session, project.id, column_name="NONEXISTENT_COLUMN",
        )

        assert result.total == 0
        assert result.items == []

    async def test_nonexistent_project_raises_404(self, db_session, seed_test_data):
        """Querying change logs for a nonexistent project should raise HTTP 404."""
        with pytest.raises(HTTPException) as exc_info:
            await list_change_logs(db_session, 99999)
        assert exc_info.value.status_code == 404
