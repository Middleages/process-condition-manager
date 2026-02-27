"""
Tests for app.repositories.backbone_repository.BackboneRepository

TDD tests covering:
- get_approved_project_for_product: found, not found, wrong status
- get_backbone_layer_map: returns {layer_id: conditions}, empty when none
- validate_backbone_source: success, raises 400 when no approved project
- list_backbone_products: lists products with approved projects, line_id filter
- get_backbone_layers: returns ProjectLayers from approved project, empty when none
"""
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Line, Layer, Product, ProductLayer, Project, ProjectLayer, User,
)
from app.repositories.backbone_repository import BackboneRepository
from app.services.auth_service import get_password_hash


# ---------------------------------------------------------------------------
# Fixture: seed backbone repository test data
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def backbone_repo_data(db_session: AsyncSession):
    """Seed data for BackboneRepository tests.

    Creates:
    - 1 user
    - 2 lines
    - 2 layers
    - 3 products:
        - prod_with_approved: has an Approved is_latest=True project
        - prod_with_draft_only: has only a Draft project (not usable as backbone)
        - prod_no_project: has no project at all
    - Approved project for prod_with_approved with 2 project_layers
    - Draft project for prod_with_draft_only
    """
    _hash = get_password_hash("test123!")

    user = User(
        username="repo_tester", display_name="Repo Tester",
        roles=["editor"], password_hash=_hash, email="repo_tester@test.local",
    )
    db_session.add(user)
    await db_session.flush()

    line_a = Line(line_code="REPO-LINE-A", line_name="Repo Line A")
    line_b = Line(line_code="REPO-LINE-B", line_name="Repo Line B")
    db_session.add_all([line_a, line_b])
    await db_session.flush()

    layer1 = Layer(layer_name="REPO_L1", step_seq="rp100000", layer_number="1.0", sort_order=10)
    layer2 = Layer(layer_name="REPO_L2", step_seq="rp200000", layer_number="2.0", sort_order=20)
    db_session.add_all([layer1, layer2])
    await db_session.flush()

    # Product A: has an Approved project -> usable as backbone
    prod_approved = Product(
        product_name="REPO-PROD-A", description="Has approved project",
        line_id=line_a.id, part_id="REPO-PROD-A",
    )
    # Product B: only has a Draft project -> NOT usable as backbone
    prod_draft = Product(
        product_name="REPO-PROD-B", description="Only draft project",
        line_id=line_a.id, part_id="REPO-PROD-B",
    )
    # Product C: no project at all -> NOT usable as backbone
    prod_none = Product(
        product_name="REPO-PROD-C", description="No project",
        line_id=line_b.id, part_id="REPO-PROD-C",
    )
    db_session.add_all([prod_approved, prod_draft, prod_none])
    await db_session.flush()

    # Approved project for prod_approved
    cond_l1 = {"SP_SPEED_rpm": 2000, "SC_ENERGY_mJ": 35.0}
    cond_l2 = {"SP_SPEED_rpm": 2500, "SC_ENERGY_mJ": 42.0}

    approved_project = Project(
        product_id=prod_approved.id,
        main_backbone_id=prod_approved.id,
        status="approved",
        revision=1,
        is_latest=True,
        created_by=user.id,
    )
    db_session.add(approved_project)
    await db_session.flush()

    pl1 = ProjectLayer(
        project_id=approved_project.id,
        layer_id=layer1.layer_number,
        layer_name=layer1.layer_name,
        step_seq=layer1.step_seq,
        backbone_product_id=prod_approved.id,
        conditions=cond_l1,
        backbone_conditions=cond_l1,
        sort_order=layer1.sort_order,
    )
    pl2 = ProjectLayer(
        project_id=approved_project.id,
        layer_id=layer2.layer_number,
        layer_name=layer2.layer_name,
        step_seq=layer2.step_seq,
        backbone_product_id=prod_approved.id,
        conditions=cond_l2,
        backbone_conditions=cond_l2,
        sort_order=layer2.sort_order,
    )
    db_session.add_all([pl1, pl2])

    # Draft project for prod_draft (NOT eligible as backbone)
    draft_project = Project(
        product_id=prod_draft.id,
        main_backbone_id=prod_approved.id,
        status="draft",
        revision=1,
        is_latest=True,
        created_by=user.id,
    )
    db_session.add(draft_project)

    # Second product also on line_a with approved project (for list tests)
    prod_line_a_2 = Product(
        product_name="REPO-PROD-D", description="Line A second approved product",
        line_id=line_a.id, part_id="REPO-PROD-D",
    )
    db_session.add(prod_line_a_2)
    await db_session.flush()

    approved_project_d = Project(
        product_id=prod_line_a_2.id,
        main_backbone_id=prod_line_a_2.id,
        status="approved",
        revision=2,
        is_latest=True,
        created_by=user.id,
    )
    db_session.add(approved_project_d)

    await db_session.commit()

    return {
        "user": user,
        "line_a": line_a,
        "line_b": line_b,
        "layer1": layer1,
        "layer2": layer2,
        "prod_approved": prod_approved,
        "prod_draft": prod_draft,
        "prod_none": prod_none,
        "prod_line_a_2": prod_line_a_2,
        "approved_project": approved_project,
        "draft_project": draft_project,
        "cond_l1": cond_l1,
        "cond_l2": cond_l2,
    }


# ---------------------------------------------------------------------------
# Tests: get_approved_project_for_product
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestGetApprovedProjectForProduct:

    async def test_returns_approved_project_when_exists(self, db_session, backbone_repo_data):
        """Should return the Approved project for a product that has one."""
        data = backbone_repo_data
        project = await BackboneRepository.get_approved_project_for_product(
            db_session, data["prod_approved"].id
        )
        assert project is not None
        assert project.status == "approved"
        assert project.is_latest is True
        assert project.product_id == data["prod_approved"].id

    async def test_returns_none_when_only_draft_exists(self, db_session, backbone_repo_data):
        """Should return None when product only has Draft projects."""
        data = backbone_repo_data
        project = await BackboneRepository.get_approved_project_for_product(
            db_session, data["prod_draft"].id
        )
        assert project is None

    async def test_returns_none_when_no_project_exists(self, db_session, backbone_repo_data):
        """Should return None when product has no projects at all."""
        data = backbone_repo_data
        project = await BackboneRepository.get_approved_project_for_product(
            db_session, data["prod_none"].id
        )
        assert project is None

    async def test_eager_loads_project_layers(self, db_session, backbone_repo_data):
        """Returned project should have layers eagerly loaded (no lazy load needed)."""
        data = backbone_repo_data
        project = await BackboneRepository.get_approved_project_for_product(
            db_session, data["prod_approved"].id
        )
        assert project is not None
        # Access layers without triggering lazy load
        assert len(project.layers) == 2


# ---------------------------------------------------------------------------
# Tests: get_backbone_layer_map
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestGetBackboneLayerMap:

    async def test_returns_layer_id_to_conditions_dict(self, db_session, backbone_repo_data):
        """Should return {layer_id: conditions} from the Approved project."""
        data = backbone_repo_data
        layer_map = await BackboneRepository.get_backbone_layer_map(
            db_session, data["prod_approved"].id
        )
        assert isinstance(layer_map, dict)
        assert len(layer_map) == 2
        assert layer_map[data["layer1"].layer_number] == data["cond_l1"]
        assert layer_map[data["layer2"].layer_number] == data["cond_l2"]

    async def test_returns_empty_dict_when_no_approved_project(self, db_session, backbone_repo_data):
        """Should return empty dict when product has no Approved project."""
        data = backbone_repo_data
        layer_map = await BackboneRepository.get_backbone_layer_map(
            db_session, data["prod_draft"].id
        )
        assert layer_map == {}

    async def test_returns_empty_dict_for_unknown_product(self, db_session, backbone_repo_data):
        """Should return empty dict for a product ID that does not exist."""
        layer_map = await BackboneRepository.get_backbone_layer_map(db_session, 99999)
        assert layer_map == {}


# ---------------------------------------------------------------------------
# Tests: validate_backbone_source
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestValidateBackboneSource:

    async def test_returns_project_when_approved_exists(self, db_session, backbone_repo_data):
        """Should return the Approved project when product qualifies as backbone."""
        data = backbone_repo_data
        project = await BackboneRepository.validate_backbone_source(
            db_session, data["prod_approved"].id
        )
        assert project is not None
        assert project.status == "approved"

    async def test_raises_400_when_only_draft(self, db_session, backbone_repo_data):
        """Should raise HTTPException(400) when product only has Draft projects."""
        data = backbone_repo_data
        with pytest.raises(HTTPException) as exc_info:
            await BackboneRepository.validate_backbone_source(
                db_session, data["prod_draft"].id
            )
        assert exc_info.value.status_code == 400
        assert "No approved project" in exc_info.value.detail

    async def test_raises_400_when_no_project(self, db_session, backbone_repo_data):
        """Should raise HTTPException(400) when product has no projects."""
        data = backbone_repo_data
        with pytest.raises(HTTPException) as exc_info:
            await BackboneRepository.validate_backbone_source(
                db_session, data["prod_none"].id
            )
        assert exc_info.value.status_code == 400

    async def test_error_message_includes_product_name(self, db_session, backbone_repo_data):
        """Error message should include the product name for clarity."""
        data = backbone_repo_data
        with pytest.raises(HTTPException) as exc_info:
            await BackboneRepository.validate_backbone_source(
                db_session, data["prod_draft"].id
            )
        assert data["prod_draft"].product_name in exc_info.value.detail


# ---------------------------------------------------------------------------
# Tests: list_backbone_products
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestListBackboneProducts:

    async def test_returns_only_products_with_approved_projects(self, db_session, backbone_repo_data):
        """Should only return products that have Approved is_latest=True projects."""
        data = backbone_repo_data
        products = await BackboneRepository.list_backbone_products(db_session)
        product_ids = [p["id"] for p in products]

        # prod_approved and prod_line_a_2 have approved projects
        assert data["prod_approved"].id in product_ids
        assert data["prod_line_a_2"].id in product_ids

        # prod_draft and prod_none do NOT have approved projects
        assert data["prod_draft"].id not in product_ids
        assert data["prod_none"].id not in product_ids

    async def test_includes_revision_number(self, db_session, backbone_repo_data):
        """Each product should include the revision number from its Approved project."""
        data = backbone_repo_data
        products = await BackboneRepository.list_backbone_products(db_session)
        prod_map = {p["id"]: p for p in products}

        assert prod_map[data["prod_approved"].id]["revision"] == 1
        assert prod_map[data["prod_line_a_2"].id]["revision"] == 2

    async def test_includes_approved_at(self, db_session, backbone_repo_data):
        """Each product should include an approved_at field (may be None)."""
        data = backbone_repo_data
        products = await BackboneRepository.list_backbone_products(db_session)
        for p in products:
            assert "approved_at" in p

    async def test_filter_by_line_id(self, db_session, backbone_repo_data):
        """Filtering by line_id should restrict results to that line only."""
        data = backbone_repo_data
        # line_a has prod_approved and prod_line_a_2 with approved projects
        products_line_a = await BackboneRepository.list_backbone_products(
            db_session, line_id=data["line_a"].id
        )
        product_ids_a = [p["id"] for p in products_line_a]
        assert data["prod_approved"].id in product_ids_a
        assert data["prod_line_a_2"].id in product_ids_a

        # line_b has prod_none (no approved project), so result should be empty
        products_line_b = await BackboneRepository.list_backbone_products(
            db_session, line_id=data["line_b"].id
        )
        assert products_line_b == []

    async def test_sorted_by_product_name(self, db_session, backbone_repo_data):
        """Results should be ordered by product_name alphabetically."""
        products = await BackboneRepository.list_backbone_products(db_session)
        names = [p["product_name"] for p in products]
        assert names == sorted(names)


# ---------------------------------------------------------------------------
# Tests: get_backbone_layers
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestGetBackboneLayers:

    async def test_returns_project_layers_for_approved_product(self, db_session, backbone_repo_data):
        """Should return ProjectLayer list from the Approved project."""
        data = backbone_repo_data
        layers = await BackboneRepository.get_backbone_layers(
            db_session, data["prod_approved"].id
        )
        assert len(layers) == 2

    async def test_layers_ordered_by_sort_order(self, db_session, backbone_repo_data):
        """Returned layers should be sorted by sort_order ascending."""
        data = backbone_repo_data
        layers = await BackboneRepository.get_backbone_layers(
            db_session, data["prod_approved"].id
        )
        sort_orders = [pl.sort_order for pl in layers]
        assert sort_orders == sorted(sort_orders)

    async def test_layer_name_denormalized(self, db_session, backbone_repo_data):
        """Each ProjectLayer should have layer_name denormalized directly."""
        data = backbone_repo_data
        layers = await BackboneRepository.get_backbone_layers(
            db_session, data["prod_approved"].id
        )
        for pl in layers:
            assert pl.layer_name is not None

    async def test_returns_empty_when_no_approved_project(self, db_session, backbone_repo_data):
        """Should return empty list when product has no Approved project."""
        data = backbone_repo_data
        layers = await BackboneRepository.get_backbone_layers(
            db_session, data["prod_draft"].id
        )
        assert layers == []

    async def test_conditions_match_approved_project(self, db_session, backbone_repo_data):
        """Layer conditions should match what was stored in the Approved project."""
        data = backbone_repo_data
        layers = await BackboneRepository.get_backbone_layers(
            db_session, data["prod_approved"].id
        )
        layer_map = {pl.layer_id: pl.conditions for pl in layers}
        assert layer_map[data["layer1"].layer_number] == data["cond_l1"]
        assert layer_map[data["layer2"].layer_number] == data["cond_l2"]
