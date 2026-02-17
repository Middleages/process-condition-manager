"""
Tests for enhanced get_change_logs() service with new filter params.
Covers: change_type, changed_by, date_from, date_to, page, backward compat with offset.
"""
import pytest
from datetime import datetime, timezone

from app.services.project_service import create_project
from app.services.condition_service import bulk_save_conditions
from app.services import change_log_service
from app.schemas.project import BulkSaveRequest, LayerConditions


@pytest.mark.asyncio
class TestChangelogEnhancedFilters:
    async def _create_project_with_changes(self, db_session, seed_test_data):
        """Helper: create a project and save conditions to generate change_log entries.

        Returns (project_id, data).
        Captures IDs before bulk_save commits (which expires ORM objects).
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
        return project_id, data

    async def test_filter_by_change_type_manual(self, db_session, seed_test_data):
        """Filter by change_type=manual returns only manual entries."""
        project_id, data = await self._create_project_with_changes(db_session, seed_test_data)

        result = await change_log_service.get_change_logs(
            db_session, project_id, change_type="manual"
        )
        assert result.total > 0
        for item in result.items:
            assert item.change_type == "manual"

    async def test_filter_by_change_type_backbone_empty(self, db_session, seed_test_data):
        """Filter by change_type=backbone returns 0 when no backbone changes exist."""
        project_id, data = await self._create_project_with_changes(db_session, seed_test_data)

        result = await change_log_service.get_change_logs(
            db_session, project_id, change_type="backbone"
        )
        # No backbone entries were created in this test scenario
        assert result.total == 0
        assert result.items == []

    async def test_filter_by_changed_by_user_id(self, db_session, seed_test_data):
        """Filter by changed_by=user_id returns only that user's entries."""
        project_id, data = await self._create_project_with_changes(db_session, seed_test_data)
        user = data["user"]

        result = await change_log_service.get_change_logs(
            db_session, project_id, changed_by=user.id
        )
        assert result.total > 0
        for item in result.items:
            assert item.changed_by == user.id

    async def test_filter_by_changed_by_nonexistent_user_empty(self, db_session, seed_test_data):
        """Filter by changed_by with a user_id that made no changes returns empty."""
        project_id, data = await self._create_project_with_changes(db_session, seed_test_data)
        reviewer = data["reviewer_user"]

        result = await change_log_service.get_change_logs(
            db_session, project_id, changed_by=reviewer.id
        )
        assert result.total == 0
        assert result.items == []

    async def test_filter_by_date_from(self, db_session, seed_test_data):
        """Filter by date_from returns entries >= that timestamp."""
        project_id, data = await self._create_project_with_changes(db_session, seed_test_data)

        # Use a time well in the past to get all entries
        date_from = datetime(2000, 1, 1, tzinfo=timezone.utc)
        result = await change_log_service.get_change_logs(
            db_session, project_id, date_from=date_from
        )
        assert result.total > 0

    async def test_filter_by_date_to_far_future(self, db_session, seed_test_data):
        """Filter by date_to in the far future returns all entries."""
        project_id, data = await self._create_project_with_changes(db_session, seed_test_data)

        date_to = datetime(2099, 1, 1, tzinfo=timezone.utc)
        result = await change_log_service.get_change_logs(
            db_session, project_id, date_to=date_to
        )
        assert result.total > 0

    async def test_filter_by_date_range_excludes_all(self, db_session, seed_test_data):
        """Filter by date range in the past returns 0 entries."""
        project_id, data = await self._create_project_with_changes(db_session, seed_test_data)

        # Far in the past
        date_from = datetime(2000, 1, 1, tzinfo=timezone.utc)
        date_to = datetime(2001, 1, 1, tzinfo=timezone.utc)
        result = await change_log_service.get_change_logs(
            db_session, project_id, date_from=date_from, date_to=date_to
        )
        assert result.total == 0
        assert result.items == []

    async def test_combined_filters(self, db_session, seed_test_data):
        """Combined filters: change_type + changed_by work together."""
        project_id, data = await self._create_project_with_changes(db_session, seed_test_data)
        user = data["user"]

        result = await change_log_service.get_change_logs(
            db_session, project_id, change_type="manual", changed_by=user.id
        )
        assert result.total > 0
        for item in result.items:
            assert item.change_type == "manual"
            assert item.changed_by == user.id

    async def test_page_based_pagination(self, db_session, seed_test_data):
        """Page-based pagination: page=1 limit=50 returns results."""
        project_id, data = await self._create_project_with_changes(db_session, seed_test_data)

        result = await change_log_service.get_change_logs(
            db_session, project_id, page=1, limit=50
        )
        assert result.page == 1
        assert result.total > 0
        assert len(result.items) <= 50

    async def test_page_based_pagination_page2_empty(self, db_session, seed_test_data):
        """Page 2 with small total returns empty items."""
        project_id, data = await self._create_project_with_changes(db_session, seed_test_data)

        result = await change_log_service.get_change_logs(
            db_session, project_id, page=2, limit=50
        )
        # We have only 2 changes, so page 2 is empty
        assert result.page == 2
        assert result.items == []

    async def test_backward_compat_offset_param(self, db_session, seed_test_data):
        """Backward compatibility: offset param still works and overrides page."""
        project_id, data = await self._create_project_with_changes(db_session, seed_test_data)

        # offset=0 returns all items
        result_all = await change_log_service.get_change_logs(
            db_session, project_id, offset=0, limit=50
        )
        # offset=1000 skips all items
        result_skip = await change_log_service.get_change_logs(
            db_session, project_id, offset=1000, limit=50
        )
        assert result_all.total > 0
        assert len(result_skip.items) == 0

    async def test_project_not_found_raises_404(self, db_session, seed_test_data):
        """Non-existent project raises HTTPException 404."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await change_log_service.get_change_logs(db_session, 999999)
        assert exc_info.value.status_code == 404

    async def test_response_includes_page_field(self, db_session, seed_test_data):
        """ChangeLogListResponse now includes a page field."""
        project_id, data = await self._create_project_with_changes(db_session, seed_test_data)

        result = await change_log_service.get_change_logs(
            db_session, project_id, page=3
        )
        assert result.page == 3
