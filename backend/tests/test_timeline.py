"""
Tests for get_timeline() service (TDD - new function).
Covers: cell changes, status changes, ordering, date grouping, pagination, edge cases.
"""
import pytest
from fastapi import HTTPException

from app.services.project.service import create_project, get_project_detail
from app.services.condition_service import bulk_save_conditions
from app.services import change_log_service
from app.schemas.project import BulkSaveRequest, LayerConditions


@pytest.mark.asyncio
class TestTimeline:
    async def _create_project_with_cell_changes(self, db_session, seed_test_data):
        """Helper: create a project and generate cell change log entries.

        Returns (project_id, data, layer_a_id).
        Captures IDs before bulk_save commits the session.
        """
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )
        layers_sorted = sorted(project.layers, key=lambda x: x.sort_order)

        # Capture before commit
        layer_a_id = layers_sorted[0].id
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

    async def _add_status_change(self, db_session, project_id, user_id):
        """Helper: directly insert a ProjectStatusLog entry without going through validation."""
        from app.models import ProjectStatusLog
        from sqlalchemy import update
        from app.models import Project

        # Directly insert a status log bypassing state machine
        log = ProjectStatusLog(
            project_id=project_id,
            from_status="draft",
            to_status="review",
            changed_by=user_id,
            comment="test status change",
        )
        db_session.add(log)
        await db_session.commit()
        return log

    async def test_timeline_with_only_cell_changes(self, db_session, seed_test_data):
        """Timeline with only cell changes returns cell_change entries."""
        project_id, data, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)

        result = await change_log_service.list_timeline(db_session, project_id)
        assert result.total > 0
        for group in result.groups:
            for entry in group.entries:
                assert entry.entry_type == "cell_change"
                assert entry.id.startswith("change-")

    async def test_timeline_with_mixed_entries(self, db_session, seed_test_data):
        """Timeline returns both cell_change and status_change entries."""
        project_id, data, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)

        # Add status change directly (bypass validation)
        await self._add_status_change(db_session, project_id, data["user"].id)

        result = await change_log_service.list_timeline(db_session, project_id)
        entry_types = {
            entry.entry_type
            for group in result.groups
            for entry in group.entries
        }
        assert "cell_change" in entry_types
        assert "status_change" in entry_types

    async def test_entries_ordered_by_timestamp_desc(self, db_session, seed_test_data):
        """All entries in timeline are ordered newest first (DESC)."""
        project_id, data, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)

        result = await change_log_service.list_timeline(db_session, project_id)
        all_entries = [e for g in result.groups for e in g.entries]
        timestamps = [e.timestamp for e in all_entries]
        assert timestamps == sorted(timestamps, reverse=True)

    async def test_date_grouping(self, db_session, seed_test_data):
        """Entries are grouped by YYYY-MM-DD date."""
        project_id, data, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)

        result = await change_log_service.list_timeline(db_session, project_id)
        for group in result.groups:
            # date should be YYYY-MM-DD format
            assert len(group.date) == 10
            assert group.date[4] == "-"
            assert group.date[7] == "-"
            # All entries in the group should have that date
            for entry in group.entries:
                entry_date = entry.timestamp.strftime("%Y-%m-%d")
                assert entry_date == group.date

    async def test_user_display_names_resolved(self, db_session, seed_test_data):
        """Timeline entries include the user display name."""
        project_id, data, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)

        result = await change_log_service.list_timeline(db_session, project_id)
        for group in result.groups:
            for entry in group.entries:
                assert entry.user_name is not None
                assert len(entry.user_name) > 0

    async def test_entry_ids_use_type_prefix(self, db_session, seed_test_data):
        """Cell changes have 'change-N' IDs; status changes have 'status-N' IDs."""
        project_id, data, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)
        # Add status change directly (bypass validation)
        await self._add_status_change(db_session, project_id, data["user"].id)

        result = await change_log_service.list_timeline(db_session, project_id)
        for group in result.groups:
            for entry in group.entries:
                if entry.entry_type == "cell_change":
                    assert entry.id.startswith("change-")
                elif entry.entry_type == "status_change":
                    assert entry.id.startswith("status-")

    async def test_pagination_page1(self, db_session, seed_test_data):
        """Pagination: page=1 limit=1 returns at most 1 entry."""
        project_id, data, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)

        result = await change_log_service.list_timeline(db_session, project_id, page=1, limit=1)
        assert result.page == 1
        assert result.limit == 1
        total_entries = sum(len(g.entries) for g in result.groups)
        assert total_entries <= 1

    async def test_pagination_page2(self, db_session, seed_test_data):
        """Pagination: page=2 with small limit returns remaining entries."""
        project_id, data, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)

        # We have 2 cell changes from SP_SPIN1_SPEED_rpm and SC_EXPOSE_ENERGY_mJ
        total_result = await change_log_service.list_timeline(db_session, project_id)
        total = total_result.total

        result_p1 = await change_log_service.list_timeline(db_session, project_id, page=1, limit=1)
        result_p2 = await change_log_service.list_timeline(db_session, project_id, page=2, limit=1)

        entries_p1 = sum(len(g.entries) for g in result_p1.groups)
        entries_p2 = sum(len(g.entries) for g in result_p2.groups)
        assert entries_p1 + entries_p2 <= total

    async def test_empty_project_returns_zero_total(self, db_session, seed_test_data):
        """Empty project with no changes returns total=0 and empty groups."""
        data = seed_test_data
        project = await create_project(
            db_session, data["target"].id, data["backbone"].id, data["user"].id,
        )

        result = await change_log_service.list_timeline(db_session, project.id)
        assert result.total == 0
        assert result.groups == []

    async def test_project_not_found_raises_404(self, db_session, seed_test_data):
        """Non-existent project raises HTTPException 404."""
        with pytest.raises(HTTPException) as exc_info:
            await change_log_service.list_timeline(db_session, 999999)
        assert exc_info.value.status_code == 404

    async def test_cell_change_details_populated(self, db_session, seed_test_data):
        """Cell change entries have layer_name, column_name, new_value in details."""
        project_id, data, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)

        result = await change_log_service.list_timeline(db_session, project_id)
        cell_entries = [
            e for g in result.groups for e in g.entries
            if e.entry_type == "cell_change"
        ]
        assert len(cell_entries) > 0
        for entry in cell_entries:
            assert entry.details.column_name is not None
            assert entry.details.change_type is not None

    async def test_status_change_details_populated(self, db_session, seed_test_data):
        """Status change entries have from_status, to_status in details."""
        project_id, data, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)
        await self._add_status_change(db_session, project_id, data["user"].id)

        result = await change_log_service.list_timeline(db_session, project_id)
        status_entries = [
            e for g in result.groups for e in g.entries
            if e.entry_type == "status_change"
        ]
        assert len(status_entries) > 0
        for entry in status_entries:
            assert entry.details.to_status is not None

    # ------------------------------------------------------------------
    # M2: Filter parameter tests
    # ------------------------------------------------------------------

    async def test_timeline_filter_by_change_type(self, db_session, seed_test_data):
        """Filter by change_type=manual returns only manual cell change entries."""
        project_id, data, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)

        # bulk_save writes manual changes
        result = await change_log_service.list_timeline(
            db_session, project_id, change_type="manual"
        )
        all_entries = [e for g in result.groups for e in g.entries]
        assert len(all_entries) > 0
        for entry in all_entries:
            assert entry.entry_type == "cell_change"
            assert entry.details.change_type == "manual"

    async def test_timeline_filter_by_changed_by(self, db_session, seed_test_data):
        """Filter by changed_by shows only entries made by that user."""
        data = seed_test_data
        project_id, _, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)
        # Add a status change by the same user
        await self._add_status_change(db_session, project_id, data["user"].id)

        user_id = data["user"].id
        result = await change_log_service.list_timeline(
            db_session, project_id, changed_by=user_id
        )
        all_entries = [e for g in result.groups for e in g.entries]
        assert len(all_entries) > 0
        for entry in all_entries:
            assert entry.user_id == user_id

    async def test_timeline_filter_by_changed_by_nonexistent_user(self, db_session, seed_test_data):
        """Filter by a user ID that has no entries returns empty result."""
        project_id, _, _ = await self._create_project_with_cell_changes(db_session, seed_test_data)

        result = await change_log_service.list_timeline(
            db_session, project_id, changed_by=999999
        )
        assert result.total == 0
        assert result.groups == []

    async def test_timeline_filter_by_layer_id(self, db_session, seed_test_data):
        """Filter by layer_id returns only changes for that layer."""
        data = seed_test_data
        project_id, _, layer_a_id = await self._create_project_with_cell_changes(db_session, seed_test_data)

        # layer_a is the first layer; get its actual Layer.id from the project layer
        from app.models import ProjectLayer
        from sqlalchemy import select as sa_select
        pl_row = (await db_session.execute(
            sa_select(ProjectLayer).where(ProjectLayer.id == layer_a_id)
        )).scalar_one()
        layer_id_value = pl_row.layer_id

        result = await change_log_service.list_timeline(
            db_session, project_id, layer_id=layer_id_value
        )
        all_entries = [e for g in result.groups for e in g.entries]
        assert len(all_entries) > 0
        # All entries should belong to layer_a
        layer_name = data["layers"][0].layer_name
        for entry in all_entries:
            if entry.entry_type == "cell_change":
                assert entry.details.layer_name == layer_name

    async def test_timeline_filter_by_layer_id_no_match(self, db_session, seed_test_data):
        """Filter by a layer_id that has no project layers returns empty result."""
        project_id, _, _ = await self._create_project_with_cell_changes(db_session, seed_test_data)

        result = await change_log_service.list_timeline(
            db_session, project_id, layer_id=999999
        )
        assert result.total == 0
        assert result.groups == []

    async def test_timeline_filter_combined(self, db_session, seed_test_data):
        """Combined change_type and changed_by filters work together."""
        data = seed_test_data
        project_id, _, _ = await self._create_project_with_cell_changes(db_session, seed_test_data)

        user_id = data["user"].id
        result = await change_log_service.list_timeline(
            db_session, project_id, change_type="manual", changed_by=user_id
        )
        all_entries = [e for g in result.groups for e in g.entries]
        assert len(all_entries) > 0
        for entry in all_entries:
            assert entry.entry_type == "cell_change"
            assert entry.details.change_type == "manual"
            assert entry.user_id == user_id

    async def test_timeline_change_type_filter_excludes_status_entries(self, db_session, seed_test_data):
        """When change_type is manual/backbone/recipe, status_change entries are excluded."""
        data = seed_test_data
        project_id, _, _ = await self._create_project_with_cell_changes(db_session, seed_test_data)
        await self._add_status_change(db_session, project_id, data["user"].id)

        # Confirm status_change exists without filter
        result_no_filter = await change_log_service.list_timeline(db_session, project_id)
        all_types_no_filter = {
            e.entry_type for g in result_no_filter.groups for e in g.entries
        }
        assert "status_change" in all_types_no_filter

        # With change_type=manual, status_change entries must be absent
        result_filtered = await change_log_service.list_timeline(
            db_session, project_id, change_type="manual"
        )
        all_types_filtered = {
            e.entry_type for g in result_filtered.groups for e in g.entries
        }
        assert "status_change" not in all_types_filtered
        assert "cell_change" in all_types_filtered
