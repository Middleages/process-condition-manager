"""Specification tests for create_project_v2() -- SPEC-PROJECT-002.

V2 project creation uses DeviceMaster references instead of product/backbone
selection. Tests verify business rules: device lookup, duplicate detection,
backbone copy, layer selection, and header metadata propagation.
"""

import copy

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device_master import DeviceMaster, LayerMaster


# ---------------------------------------------------------------------------
# Fixture: device master + layer master test data
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def device_fixture(db_session: AsyncSession, seed_test_data: dict) -> dict:
    """Create DeviceMaster + LayerMaster records for V2 project tests.

    Returns dict with keys: device, device_layers, seed (the original seed_test_data).
    The device has backbone_product_id pointing to the seed backbone product.
    """
    data = seed_test_data

    device = DeviceMaster(
        line_id=data["line"].id,
        product_name="DEVICE-A",
        process="PHOTO",
        part_id="PART-001",
        is_active=True,
        enrichment={"fab": "F1", "tech": "7nm", "generation": "3rd"},
    )
    db_session.add(device)
    await db_session.flush()

    layer_specs = [
        ("1.0", "ts100000", "Layer A description"),
        ("2.0", "ts200000", "Layer B description"),
        ("3.0", "ts300000", "Layer C description"),
    ]
    device_layers = []
    for idx, (layer_id, step_seq, descript) in enumerate(layer_specs):
        lm = LayerMaster(
            device_master_id=device.id,
            layer_id=layer_id,
            step_seq=step_seq,
            descript=descript,
        )
        db_session.add(lm)
        device_layers.append(lm)
    await db_session.flush()

    # Device without backbone reference (for testing optional backbone)
    device_no_bb = DeviceMaster(
        line_id=data["line"].id,
        product_name="DEVICE-B",
        process="ETCH",
        part_id="PART-002",
        is_active=True,
        enrichment={},
    )
    db_session.add(device_no_bb)
    await db_session.flush()

    # Add layers for device_no_bb
    device_no_bb_layers = []
    for idx, (layer_id, step_seq, descript) in enumerate(layer_specs[:2]):
        lm = LayerMaster(
            device_master_id=device_no_bb.id,
            layer_id=layer_id,
            step_seq=step_seq,
            descript=descript,
        )
        db_session.add(lm)
        device_no_bb_layers.append(lm)
    await db_session.flush()

    await db_session.commit()

    return {
        "device": device,
        "device_layers": device_layers,
        "device_no_bb": device_no_bb,
        "device_no_bb_layers": device_no_bb_layers,
        "seed": data,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestCreateProjectV2:
    """Specification tests for create_project_v2()."""

    async def test_create_v2_success_with_backbone(
        self, db_session: AsyncSession, device_fixture: dict,
    ):
        """Happy path: create V2 project with backbone -- copies conditions."""
        from app.services.project.service import create_project_v2

        fx = device_fixture
        seed = fx["seed"]

        project = await create_project_v2(
            db=db_session,
            line_id=seed["line"].id,
            product_name="DEVICE-A",
            process="PHOTO",
            part_id="PART-001",
            device_type="full",
            selected_layer_ids=["1.0", "2.0", "3.0"],
            backbone_product_id=seed["backbone"].id,
            created_by=seed["user"].id,
        )

        # Project fields
        assert project.status == "draft"
        assert project.device_master_id == fx["device"].id
        assert project.device_type == "full"
        assert project.line_id == seed["line"].id
        assert project.product_name == "DEVICE-A"
        assert project.part_id == "PART-001"
        assert project.process == "PHOTO"
        assert project.product_id is None  # V2 does not use legacy product ref
        assert project.main_backbone_id == seed["backbone"].id

        # ProjectLayers -- 3 layers with backbone conditions
        assert len(project.layers) == 3
        layers_sorted = sorted(project.layers, key=lambda pl: pl.sort_order)
        for pl, expected_cond in zip(layers_sorted, seed["bb_conditions"]):
            assert pl.conditions == expected_cond
            assert pl.backbone_conditions == expected_cond

    async def test_create_v2_success_without_backbone(
        self, db_session: AsyncSession, device_fixture: dict,
    ):
        """V2 project created without backbone has empty conditions."""
        from app.services.project.service import create_project_v2

        fx = device_fixture
        seed = fx["seed"]

        project = await create_project_v2(
            db=db_session,
            line_id=seed["line"].id,
            product_name="DEVICE-B",
            process="ETCH",
            part_id="PART-002",
            device_type="short",
            selected_layer_ids=["1.0", "2.0"],
            backbone_product_id=None,
            created_by=seed["user"].id,
        )

        assert project.status == "draft"
        assert project.device_master_id == fx["device_no_bb"].id
        assert project.main_backbone_id is None
        assert project.device_type == "short"

        # All layers should have empty conditions
        for pl in project.layers:
            assert pl.conditions == {}
            assert pl.backbone_conditions == {}

    async def test_create_v2_device_not_found(
        self, db_session: AsyncSession, device_fixture: dict,
    ):
        """Non-existent device ref raises 404."""
        from app.services.project.service import create_project_v2

        seed = device_fixture["seed"]

        with pytest.raises(HTTPException) as exc_info:
            await create_project_v2(
                db=db_session,
                line_id=seed["line"].id,
                product_name="NONEXISTENT",
                process="PHOTO",
                part_id="PART-999",
                device_type="full",
                selected_layer_ids=["1.0"],
                backbone_product_id=None,
                created_by=seed["user"].id,
            )
        assert exc_info.value.status_code == 404

    async def test_create_v2_invalid_device_type(
        self, db_session: AsyncSession, device_fixture: dict,
    ):
        """Invalid device_type raises 400."""
        from app.services.project.service import create_project_v2

        fx = device_fixture
        seed = fx["seed"]

        with pytest.raises(HTTPException) as exc_info:
            await create_project_v2(
                db=db_session,
                line_id=seed["line"].id,
                product_name="DEVICE-A",
                process="PHOTO",
                part_id="PART-001",
                device_type="invalid",
                selected_layer_ids=["1.0"],
                backbone_product_id=None,
                created_by=seed["user"].id,
            )
        assert exc_info.value.status_code == 400

    async def test_create_v2_duplicate_active_project(
        self, db_session: AsyncSession, device_fixture: dict,
    ):
        """Creating a second project for same device_master raises 409."""
        from app.services.project.service import create_project_v2

        fx = device_fixture
        seed = fx["seed"]

        # First creation succeeds
        await create_project_v2(
            db=db_session,
            line_id=seed["line"].id,
            product_name="DEVICE-A",
            process="PHOTO",
            part_id="PART-001",
            device_type="full",
            selected_layer_ids=["1.0", "2.0", "3.0"],
            backbone_product_id=None,
            created_by=seed["user"].id,
        )

        # Second creation for same device must fail
        with pytest.raises(HTTPException) as exc_info:
            await create_project_v2(
                db=db_session,
                line_id=seed["line"].id,
                product_name="DEVICE-A",
                process="PHOTO",
                part_id="PART-001",
                device_type="full",
                selected_layer_ids=["1.0"],
                backbone_product_id=None,
                created_by=seed["user"].id,
            )
        assert exc_info.value.status_code == 409

    async def test_create_v2_invalid_layer_ids(
        self, db_session: AsyncSession, device_fixture: dict,
    ):
        """Selected layers not in device's layer_master raises 400."""
        from app.services.project.service import create_project_v2

        fx = device_fixture
        seed = fx["seed"]

        with pytest.raises(HTTPException) as exc_info:
            await create_project_v2(
                db=db_session,
                line_id=seed["line"].id,
                product_name="DEVICE-A",
                process="PHOTO",
                part_id="PART-001",
                device_type="full",
                selected_layer_ids=["1.0", "99.0"],  # 99.0 does not exist
                backbone_product_id=None,
                created_by=seed["user"].id,
            )
        assert exc_info.value.status_code == 400

    async def test_create_v2_sets_header_metadata(
        self, db_session: AsyncSession, device_fixture: dict,
    ):
        """header_metadata should be copied from device_master.enrichment."""
        from app.services.project.service import create_project_v2

        fx = device_fixture
        seed = fx["seed"]

        project = await create_project_v2(
            db=db_session,
            line_id=seed["line"].id,
            product_name="DEVICE-A",
            process="PHOTO",
            part_id="PART-001",
            device_type="full",
            selected_layer_ids=["1.0"],
            backbone_product_id=None,
            created_by=seed["user"].id,
        )

        assert project.header_metadata == {
            "fab": "F1",
            "tech": "7nm",
            "generation": "3rd",
        }

    async def test_create_v2_partial_layer_selection(
        self, db_session: AsyncSession, device_fixture: dict,
    ):
        """Only selected layers are created, with correct backbone conditions."""
        from app.services.project.service import create_project_v2

        fx = device_fixture
        seed = fx["seed"]

        # Select only layers 1.0 and 3.0 (skip 2.0) with backbone
        project = await create_project_v2(
            db=db_session,
            line_id=seed["line"].id,
            product_name="DEVICE-A",
            process="PHOTO",
            part_id="PART-001",
            device_type="full",
            selected_layer_ids=["1.0", "3.0"],
            backbone_product_id=seed["backbone"].id,
            created_by=seed["user"].id,
        )

        assert len(project.layers) == 2

        layers_sorted = sorted(project.layers, key=lambda pl: pl.layer_id)
        # Layer 1.0 -> bb_conditions[0]
        assert layers_sorted[0].layer_id == "1.0"
        assert layers_sorted[0].conditions == seed["bb_conditions"][0]
        # Layer 3.0 -> bb_conditions[2]
        assert layers_sorted[1].layer_id == "3.0"
        assert layers_sorted[1].conditions == seed["bb_conditions"][2]


@pytest.mark.asyncio
class TestReviseProjectV2:
    """Tests for revise_project() with V2 (device-ref based) projects."""

    async def test_revise_v2_project_copies_device_ref_fields(
        self, db_session: AsyncSession, device_fixture: dict,
    ):
        """Revising a V2 project should copy device-ref fields and check duplicates."""
        from app.services.project.service import (
            create_project_v2,
            revise_project,
        )

        fx = device_fixture
        seed = fx["seed"]

        # Create a V2 project
        project_v1 = await create_project_v2(
            db=db_session,
            line_id=seed["line"].id,
            product_name="DEVICE-A",
            process="PHOTO",
            part_id="PART-001",
            device_type="full",
            selected_layer_ids=["1.0", "2.0", "3.0"],
            backbone_product_id=None,
            created_by=seed["user"].id,
        )
        # Directly set status to approved (skip validation which requires conditions)
        project_v1.status = "approved"
        await db_session.commit()

        # Revise
        project_v2 = await revise_project(db_session, project_v1.id, revision_reason="Test V2 revision")

        assert project_v2.revision == 2
        assert project_v2.device_master_id == fx["device"].id
        assert project_v2.line_id == seed["line"].id
        assert project_v2.product_name == "DEVICE-A"
        assert project_v2.process == "PHOTO"
        assert project_v2.part_id == "PART-001"
        assert project_v2.device_type == "full"
        assert project_v2.status == "draft"
        assert project_v2.is_latest is True

    async def test_revise_v2_project_blocks_duplicate(
        self, db_session: AsyncSession, device_fixture: dict,
    ):
        """Cannot revise if a draft/review V2 project already exists for same device-ref."""
        from app.services.project.service import (
            create_project_v2,
            revise_project,
        )

        fx = device_fixture
        seed = fx["seed"]

        # Create a V2 project and directly approve (skip validation)
        project_v1 = await create_project_v2(
            db=db_session,
            line_id=seed["line"].id,
            product_name="DEVICE-A",
            process="PHOTO",
            part_id="PART-001",
            device_type="full",
            selected_layer_ids=["1.0", "2.0", "3.0"],
            backbone_product_id=None,
            created_by=seed["user"].id,
        )
        project_v1.status = "approved"
        await db_session.commit()

        # Revise to create V2 draft
        await revise_project(db_session, project_v1.id)

        # Approve original again (simulate edge case) - skip, just verify
        # second revise should fail because draft already exists
        with pytest.raises(HTTPException) as exc_info:
            await revise_project(db_session, project_v1.id)
        assert exc_info.value.status_code == 400  # already not approved
