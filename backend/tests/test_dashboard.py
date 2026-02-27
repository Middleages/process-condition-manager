"""
Tests for app.repositories.dashboard_repository.DashboardRepository

Integration tests using SQLite in-memory DB via conftest fixtures.

Coverage:
- fetch_status_counts: per-status counts, line_id filter, empty DB
- fetch_my_recent_projects: user filter, line_id filter, limit
- fetch_review_pending: review status only, line_id filter
- fetch_recent_activity: timeline, line_id filter
"""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ChangeLog, Line, Product, Layer, Project, ProjectLayer,
    ProjectStatusLog, User,
)
from app.repositories.dashboard_repository import DashboardRepository
from app.services.auth_service import get_password_hash


# ---------------------------------------------------------------------------
# Fixture: seed dashboard-specific test data
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def dashboard_data(db_session: AsyncSession):
    """Seed data for dashboard tests.

    Creates:
    - 2 users (editor, reviewer)
    - 2 lines (LINE-A, LINE-B)
    - 2 layers
    - 4 products (2 per line)
    - 5 projects: 2 draft, 1 review, 1 approved, 1 rejected (various lines)
    - Status logs for activity timeline
    - ChangeLogs for changed_cells_count
    """
    _hash = get_password_hash("test123!")

    editor = User(
        username="editor1", display_name="Editor One",
        roles=["editor"], password_hash=_hash, email="editor1@test.local",
    )
    reviewer = User(
        username="reviewer1", display_name="Reviewer One",
        roles=["reviewer"], password_hash=_hash, email="reviewer1@test.local",
    )
    db_session.add_all([editor, reviewer])
    await db_session.flush()

    line_a = Line(line_code="LINE-A", line_name="Line A")
    line_b = Line(line_code="LINE-B", line_name="Line B")
    db_session.add_all([line_a, line_b])
    await db_session.flush()

    layer1 = Layer(layer_name="L1", step_seq="s100", layer_number="1.0", sort_order=10)
    layer2 = Layer(layer_name="L2", step_seq="s200", layer_number="2.0", sort_order=20)
    db_session.add_all([layer1, layer2])
    await db_session.flush()

    # Products: 2 backbone source products (one per line, will have Approved projects)
    bb_a = Product(
        product_name="BB-A", description="Backbone A",
        line_id=line_a.id, part_id="BB-A",
    )
    bb_b = Product(
        product_name="BB-B", description="Backbone B",
        line_id=line_b.id, part_id="BB-B",
    )
    prod_a = Product(
        product_name="PROD-A", description="Product A",
        line_id=line_a.id, part_id="PROD-A",
    )
    prod_b = Product(
        product_name="PROD-B", description="Product B",
        line_id=line_b.id, part_id="PROD-B",
    )
    db_session.add_all([bb_a, bb_b, prod_a, prod_b])
    await db_session.flush()

    # Projects with various statuses
    projects = []
    statuses = ["draft", "draft", "review", "approved", "rejected"]
    products = [prod_a, prod_a, prod_b, prod_a, prod_b]
    backbones = [bb_a, bb_a, bb_b, bb_a, bb_b]
    for i, (status, prod, bb) in enumerate(zip(statuses, products, backbones)):
        p = Project(
            product_id=prod.id,
            main_backbone_id=bb.id,
            status=status,
            revision=1,
            is_latest=True,
            created_by=editor.id,
        )
        db_session.add(p)
        projects.append(p)
    await db_session.flush()

    # ProjectLayers for each project (needed for ChangeLog join)
    project_layers = []
    for proj in projects:
        pl = ProjectLayer(
            project_id=proj.id, layer_id=layer1.layer_number,
            layer_name=layer1.layer_name, step_seq=layer1.step_seq,
            conditions={"COL_A": "10"}, sort_order=0,
        )
        db_session.add(pl)
        project_layers.append(pl)
    await db_session.flush()

    # ChangeLogs for the first project (2 changes)
    for col_name in ["COL_A", "COL_B"]:
        cl = ChangeLog(
            project_layer_id=project_layers[0].id,
            column_name=col_name,
            old_value="0", new_value="10",
            change_type="manual",
            changed_by=editor.id,
        )
        db_session.add(cl)

    # Status logs for activity timeline
    status_transitions = [
        (projects[2], "draft", "review", editor),
        (projects[3], "draft", "review", editor),
        (projects[3], "review", "approved", reviewer),
        (projects[4], "draft", "review", editor),
        (projects[4], "review", "rejected", reviewer),
    ]
    for proj, from_s, to_s, user in status_transitions:
        sl = ProjectStatusLog(
            project_id=proj.id,
            from_status=from_s, to_status=to_s,
            changed_by=user.id,
            comment=f"{from_s}->{to_s}",
        )
        db_session.add(sl)

    await db_session.commit()

    return {
        "editor": editor,
        "reviewer": reviewer,
        "line_a": line_a,
        "line_b": line_b,
        "projects": projects,
        "project_layers": project_layers,
        "prod_a": prod_a,
        "prod_b": prod_b,
    }


# ===========================================================================
# fetch_status_counts
# ===========================================================================

class TestFetchStatusCounts:

    @pytest.mark.asyncio
    async def test_counts_all(self, db_session, dashboard_data):
        counts = await DashboardRepository.fetch_status_counts(db_session)
        assert counts["draft"] == 2
        assert counts["review"] == 1
        assert counts["approved"] == 1
        assert counts["rejected"] == 1

    @pytest.mark.asyncio
    async def test_counts_with_line_filter(self, db_session, dashboard_data):
        data = dashboard_data
        # Line A products: PROD-A -> projects[0](draft), projects[1](draft), projects[3](approved)
        counts = await DashboardRepository.fetch_status_counts(
            db_session, line_id=data["line_a"].id,
        )
        assert counts["draft"] == 2
        assert counts["approved"] == 1
        assert counts["review"] == 0
        assert counts["rejected"] == 0

    @pytest.mark.asyncio
    async def test_counts_empty_db(self, db_session):
        """No projects at all -> all zeros."""
        counts = await DashboardRepository.fetch_status_counts(db_session)
        assert counts == {"draft": 0, "review": 0, "approved": 0, "rejected": 0}


# ===========================================================================
# fetch_my_recent_projects
# ===========================================================================

class TestFetchMyRecentProjects:

    @pytest.mark.asyncio
    async def test_returns_user_projects(self, db_session, dashboard_data):
        data = dashboard_data
        results = await DashboardRepository.fetch_my_recent_projects(
            db_session, user_id=data["editor"].id,
        )
        assert len(results) == 5  # All projects created by editor

    @pytest.mark.asyncio
    async def test_respects_limit(self, db_session, dashboard_data):
        data = dashboard_data
        results = await DashboardRepository.fetch_my_recent_projects(
            db_session, user_id=data["editor"].id, limit=2,
        )
        assert len(results) == 2

    @pytest.mark.asyncio
    async def test_line_id_filter(self, db_session, dashboard_data):
        data = dashboard_data
        results = await DashboardRepository.fetch_my_recent_projects(
            db_session, user_id=data["editor"].id, line_id=data["line_b"].id,
        )
        # Line B -> PROD-B -> projects[2](review), projects[4](rejected)
        assert len(results) == 2
        for r in results:
            assert r["product_name"] == "PROD-B"

    @pytest.mark.asyncio
    async def test_changed_cells_count(self, db_session, dashboard_data):
        data = dashboard_data
        results = await DashboardRepository.fetch_my_recent_projects(
            db_session, user_id=data["editor"].id,
        )
        # Find the first project which has 2 change logs
        first_proj_result = next(
            r for r in results if r["id"] == data["projects"][0].id
        )
        assert first_proj_result["changed_cells_count"] == 2

    @pytest.mark.asyncio
    async def test_other_user_no_results(self, db_session, dashboard_data):
        data = dashboard_data
        results = await DashboardRepository.fetch_my_recent_projects(
            db_session, user_id=data["reviewer"].id,
        )
        assert len(results) == 0


# ===========================================================================
# fetch_review_pending
# ===========================================================================

class TestFetchReviewPending:

    @pytest.mark.asyncio
    async def test_returns_review_only(self, db_session, dashboard_data):
        results = await DashboardRepository.fetch_review_pending(db_session)
        assert len(results) == 1
        assert results[0]["product_name"] == "PROD-B"

    @pytest.mark.asyncio
    async def test_line_id_filter(self, db_session, dashboard_data):
        data = dashboard_data
        # Line A has no review projects
        results = await DashboardRepository.fetch_review_pending(
            db_session, line_id=data["line_a"].id,
        )
        assert len(results) == 0

        # Line B has 1 review project
        results = await DashboardRepository.fetch_review_pending(
            db_session, line_id=data["line_b"].id,
        )
        assert len(results) == 1

    @pytest.mark.asyncio
    async def test_includes_creator_name(self, db_session, dashboard_data):
        results = await DashboardRepository.fetch_review_pending(db_session)
        assert results[0]["creator_name"] == "Editor One"


# ===========================================================================
# fetch_recent_activity
# ===========================================================================

class TestFetchRecentActivity:

    @pytest.mark.asyncio
    async def test_returns_timeline(self, db_session, dashboard_data):
        results = await DashboardRepository.fetch_recent_activity(db_session)
        assert len(results) == 5  # 5 status transitions

    @pytest.mark.asyncio
    async def test_respects_limit(self, db_session, dashboard_data):
        results = await DashboardRepository.fetch_recent_activity(db_session, limit=2)
        assert len(results) == 2

    @pytest.mark.asyncio
    async def test_line_id_filter(self, db_session, dashboard_data):
        data = dashboard_data
        # Line A: projects[3] has 2 transitions (draft->review, review->approved)
        results = await DashboardRepository.fetch_recent_activity(
            db_session, line_id=data["line_a"].id,
        )
        assert len(results) == 2
        for r in results:
            assert r["product_name"] == "PROD-A"

    @pytest.mark.asyncio
    async def test_includes_changer_name(self, db_session, dashboard_data):
        results = await DashboardRepository.fetch_recent_activity(db_session)
        changer_names = {r["changer_name"] for r in results}
        assert "Editor One" in changer_names
        assert "Reviewer One" in changer_names
