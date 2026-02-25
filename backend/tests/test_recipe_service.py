"""Tests for the Recipe XML parsing, diff, and apply service."""

import pytest
import pytest_asyncio
from pathlib import Path
from lxml import etree

from app.models import (
    Project, ProjectLayer, ColumnCategory, ColumnDefinition, RecipeXmlMapping,
)
from app.services.recipe_service import (
    apply_transform,
    extract_layer_key,
    match_layer_to_project,
    parse_recipe_xml,
    apply_recipe_changes,
)
from app.schemas.recipe import RecipeApplyRequest, RecipeApplyItem


FIXTURES_DIR = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Unit tests: value transforms
# ---------------------------------------------------------------------------

class TestApplyTransform:
    def test_none_transform(self):
        assert apply_transform("hello", None) == "hello"

    def test_to_int(self):
        assert apply_transform("42", "to_int") == 42
        assert apply_transform("42.7", "to_int") == 42

    def test_to_float(self):
        assert apply_transform("3.14", "to_float") == 3.14
        assert apply_transform("42", "to_float") == 42.0

    def test_yn_to_bool_true(self):
        for val in ("true", "True", "1", "yes", "Y", "y"):
            assert apply_transform(val, "yn_to_bool") == "Y"

    def test_yn_to_bool_false(self):
        for val in ("false", "False", "0", "no", "N", "n"):
            assert apply_transform(val, "yn_to_bool") == "N"

    def test_empty_value_returns_none(self):
        assert apply_transform("", None) is None
        assert apply_transform("  ", "to_int") is None

    def test_unknown_transform_returns_raw(self):
        assert apply_transform("hello", "unknown_transform") == "hello"


# ---------------------------------------------------------------------------
# Unit tests: layer key extraction
# ---------------------------------------------------------------------------

class TestExtractLayerKey:
    def test_extract_from_pid(self):
        xml = b"<RecipeStep><RECIPE><RECIPE_NAME><PID>STI_PHOTO_SA.rcp</PID></RECIPE_NAME></RECIPE></RecipeStep>"
        root = etree.fromstring(xml)
        key = extract_layer_key(root)
        assert key == "STI_PHOTO"

    def test_extract_from_pid_simple(self):
        xml = b"<RecipeStep><RECIPE><RECIPE_NAME><PID>M1_PHOTO.rcp</PID></RECIPE_NAME></RECIPE></RecipeStep>"
        root = etree.fromstring(xml)
        key = extract_layer_key(root)
        assert key == "M1_PHOTO"

    def test_extract_from_filename(self):
        xml = b"<RecipeStep><RECIPE></RECIPE></RecipeStep>"
        root = etree.fromstring(xml)
        key = extract_layer_key(root, filename="POLY_PHOTO_recipe.xml")
        assert key == "POLY_PHOTO"

    def test_no_key_found(self):
        xml = b"<RecipeStep><RECIPE></RECIPE></RecipeStep>"
        root = etree.fromstring(xml)
        key = extract_layer_key(root)
        assert key is None


# ---------------------------------------------------------------------------
# Unit tests: layer matching
# ---------------------------------------------------------------------------

class TestMatchLayerToProject:
    @pytest_asyncio.fixture
    async def project_layers(self, db_session):
        """Create simple project layers for matching tests."""
        from app.models import User, Line, Product, Layer

        user = User(username="test_user", display_name="Test", roles=["editor"])
        line = Line(line_code="L1", line_name="Line 1")
        db_session.add_all([user, line])
        await db_session.flush()

        prod = Product(product_name="TEST", line_id=line.id)
        db_session.add(prod)
        await db_session.flush()

        project = Project(
            product_id=prod.id, main_backbone_id=prod.id,
            status="draft", created_by=user.id,
        )
        db_session.add(project)
        await db_session.flush()

        layers_data = [
            ("STI_PHOTO", "ts100000", "1.0", 10),
            ("POLY_PHOTO", "ts200000", "2.0", 20),
            ("M1_PHOTO", "ts300000", "3.0", 30),
        ]
        layers = []
        pls = []
        for name, seq, num, order in layers_data:
            layer = Layer(layer_name=name, step_seq=seq, layer_number=num, sort_order=order)
            db_session.add(layer)
            await db_session.flush()
            layers.append(layer)

            pl = ProjectLayer(
                project_id=project.id, layer_id=layer.id,
                backbone_product_id=prod.id, conditions={}, backbone_conditions={},
                sort_order=order,
            )
            db_session.add(pl)
            pls.append(pl)

        await db_session.flush()
        # Attach layer relationship manually for test
        for pl, layer in zip(pls, layers):
            pl.layer = layer
        return pls

    def test_exact_match(self, project_layers):
        result = match_layer_to_project("STI_PHOTO", project_layers)
        assert result is not None
        assert result.layer.layer_name == "STI_PHOTO"

    def test_partial_match(self, project_layers):
        result = match_layer_to_project("STI", project_layers)
        assert result is not None
        assert result.layer.layer_name == "STI_PHOTO"

    def test_no_match(self, project_layers):
        result = match_layer_to_project("CONTACT_PHOTO", project_layers)
        assert result is None


# ---------------------------------------------------------------------------
# Integration tests: parse_recipe_xml
# ---------------------------------------------------------------------------

class TestParseRecipeXml:
    @pytest_asyncio.fixture
    async def setup_data(self, db_session):
        """Set up project, layers, column defs, and xml mappings."""
        from app.models import User, Line, Product, Layer

        user = User(username="recipe_tester", display_name="Recipe Tester", roles=["editor"])
        line = Line(line_code="RL1", line_name="Recipe Line")
        db_session.add_all([user, line])
        await db_session.flush()

        prod = Product(product_name="RCP-PROD", line_id=line.id)
        db_session.add(prod)
        await db_session.flush()

        project = Project(
            product_id=prod.id, main_backbone_id=prod.id,
            status="draft", created_by=user.id,
        )
        db_session.add(project)
        await db_session.flush()

        # Layers
        layer = Layer(layer_name="STI_PHOTO", step_seq="ts100", layer_number="1.0", sort_order=10)
        db_session.add(layer)
        await db_session.flush()

        pl = ProjectLayer(
            project_id=project.id, layer_id=layer.id,
            backbone_product_id=prod.id,
            conditions={
                "SP_SPIN1_SPEED_rpm": 2000,
                "SC_EXPOSE_ENERGY_mJ": 35.0,
                "DEV_PUDDLE_TIME_sec": 45,
            },
            backbone_conditions={
                "SP_SPIN1_SPEED_rpm": 2000,
                "SC_EXPOSE_ENERGY_mJ": 35.0,
            },
            sort_order=10,
        )
        db_session.add(pl)
        await db_session.flush()

        # Column categories and definitions
        cat_sp = ColumnCategory(category_code="SP", category_name="Spin/PR", sort_order=1)
        cat_sc = ColumnCategory(category_code="SC", category_name="Scanner", sort_order=2)
        cat_dev = ColumnCategory(category_code="DEV", category_name="Develop", sort_order=3)
        db_session.add_all([cat_sp, cat_sc, cat_dev])
        await db_session.flush()

        col_speed = ColumnDefinition(
            column_name="SP_SPIN1_SPEED_rpm", display_name="Spin1 Speed",
            category_id=cat_sp.id, data_type="integer", sort_order=1, is_required=True,
        )
        col_energy = ColumnDefinition(
            column_name="SC_EXPOSE_ENERGY_mJ", display_name="Expose Energy",
            category_id=cat_sc.id, data_type="float", sort_order=1, is_required=True,
        )
        col_puddle = ColumnDefinition(
            column_name="DEV_PUDDLE_TIME_sec", display_name="Puddle Time",
            category_id=cat_dev.id, data_type="integer", sort_order=1, is_required=False,
        )
        db_session.add_all([col_speed, col_energy, col_puddle])
        await db_session.flush()

        # XML Mappings
        m1 = RecipeXmlMapping(
            xpath="//RECIPE_DATA/SPIN/SPIN1_SPEED", column_id=col_speed.id,
            value_transform="to_int", is_active=True,
        )
        m2 = RecipeXmlMapping(
            xpath="//RECIPE_DATA/EXPOSE/ENERGY", column_id=col_energy.id,
            value_transform="to_float", is_active=True,
        )
        m3 = RecipeXmlMapping(
            xpath="//RECIPE_DATA/DEVELOP/PUDDLE_TIME", column_id=col_puddle.id,
            value_transform="to_int", is_active=True,
        )
        db_session.add_all([m1, m2, m3])
        await db_session.commit()

        return {
            "project": project,
            "project_layer": pl,
            "user": user,
            "layer": layer,
        }

    @pytest.mark.asyncio
    async def test_parse_xml_extracts_values(self, db_session, setup_data):
        xml_content = (FIXTURES_DIR / "sample_recipe.xml").read_bytes()
        result = await parse_recipe_xml(db_session, setup_data["project"].id, xml_content)

        assert result.detected_layer_key == "STI_PHOTO"
        assert result.project_layer_id == setup_data["project_layer"].id
        assert result.layer_name == "STI_PHOTO"
        assert result.total_mapped > 0

    @pytest.mark.asyncio
    async def test_parse_xml_detects_diffs(self, db_session, setup_data):
        xml_content = (FIXTURES_DIR / "sample_recipe.xml").read_bytes()
        result = await parse_recipe_xml(db_session, setup_data["project"].id, xml_content)

        # Spin1 Speed: current=2000, recipe=2100 → different
        speed_item = next((i for i in result.items if i.column_name == "SP_SPIN1_SPEED_rpm"), None)
        assert speed_item is not None
        assert speed_item.recipe_value == 2100
        assert speed_item.is_different is True

        # Expose Energy: current=35.0, recipe=32.5 → different
        energy_item = next((i for i in result.items if i.column_name == "SC_EXPOSE_ENERGY_mJ"), None)
        assert energy_item is not None
        assert energy_item.recipe_value == 32.5
        assert energy_item.is_different is True

        assert result.diff_count >= 2

    @pytest.mark.asyncio
    async def test_parse_xml_with_filename_fallback(self, db_session, setup_data):
        # XML without PID
        xml_content = b"""<?xml version="1.0"?>
        <RecipeStep><RECIPE><RECIPE_DATA>
            <SPIN><SPIN1_SPEED>3000</SPIN1_SPEED></SPIN>
            <EXPOSE><ENERGY>40.0</ENERGY></EXPOSE>
            <DEVELOP><PUDDLE_TIME>60</PUDDLE_TIME></DEVELOP>
        </RECIPE_DATA></RECIPE></RecipeStep>"""

        result = await parse_recipe_xml(
            db_session, setup_data["project"].id, xml_content,
            filename="STI_PHOTO_recipe.xml",
        )
        assert result.detected_layer_key == "STI_PHOTO"
        assert result.project_layer_id is not None

    @pytest.mark.asyncio
    async def test_parse_xml_malformed(self, db_session, setup_data):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await parse_recipe_xml(db_session, setup_data["project"].id, b"<not valid xml>")
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_parse_xml_no_mappings(self, db_session, setup_data):
        """When all mappings are inactive, should return empty result with warning."""
        from sqlalchemy import update
        await db_session.execute(
            update(RecipeXmlMapping).values(is_active=False)
        )
        await db_session.commit()

        xml_content = (FIXTURES_DIR / "sample_recipe.xml").read_bytes()
        result = await parse_recipe_xml(db_session, setup_data["project"].id, xml_content)

        assert result.total_mapped == 0
        assert len(result.warnings) > 0


# ---------------------------------------------------------------------------
# Integration tests: apply_recipe_changes
# ---------------------------------------------------------------------------

class TestApplyRecipeChanges:
    @pytest_asyncio.fixture
    async def setup_data(self, db_session):
        """Same setup as parse tests."""
        from app.models import User, Line, Product, Layer

        user = User(username="apply_tester", display_name="Apply Tester", roles=["editor"])
        line = Line(line_code="AL1", line_name="Apply Line")
        db_session.add_all([user, line])
        await db_session.flush()

        prod = Product(product_name="APPLY-PROD", line_id=line.id)
        db_session.add(prod)
        await db_session.flush()

        project = Project(
            product_id=prod.id, main_backbone_id=prod.id,
            status="draft", created_by=user.id,
        )
        db_session.add(project)
        await db_session.flush()

        layer = Layer(layer_name="LAYER_X", step_seq="ts100", layer_number="1.0", sort_order=10)
        db_session.add(layer)
        await db_session.flush()

        pl = ProjectLayer(
            project_id=project.id, layer_id=layer.id,
            backbone_product_id=prod.id,
            conditions={"SP_SPIN1_SPEED_rpm": 2000, "SC_EXPOSE_ENERGY_mJ": 35.0},
            backbone_conditions={"SP_SPIN1_SPEED_rpm": 2000, "SC_EXPOSE_ENERGY_mJ": 35.0},
            sort_order=10,
        )
        db_session.add(pl)
        await db_session.commit()

        return {"project": project, "project_layer": pl, "user": user}

    @pytest.mark.asyncio
    async def test_apply_changes(self, db_session, setup_data):
        request = RecipeApplyRequest(
            changes=[
                RecipeApplyItem(
                    project_layer_id=setup_data["project_layer"].id,
                    column_name="SP_SPIN1_SPEED_rpm",
                    new_value=2100,
                ),
                RecipeApplyItem(
                    project_layer_id=setup_data["project_layer"].id,
                    column_name="SC_EXPOSE_ENERGY_mJ",
                    new_value=32.5,
                ),
            ],
            applied_by=setup_data["user"].id,
        )

        result = await apply_recipe_changes(
            db_session, setup_data["project"].id, request,
        )

        assert result.applied_count == 2
        assert result.change_log_count == 2

        # Verify the conditions were updated
        await db_session.refresh(setup_data["project_layer"])
        assert setup_data["project_layer"].conditions["SP_SPIN1_SPEED_rpm"] == 2100
        assert setup_data["project_layer"].conditions["SC_EXPOSE_ENERGY_mJ"] == 32.5

    @pytest.mark.asyncio
    async def test_apply_no_diff(self, db_session, setup_data):
        """Applying same value should not create change logs."""
        request = RecipeApplyRequest(
            changes=[
                RecipeApplyItem(
                    project_layer_id=setup_data["project_layer"].id,
                    column_name="SP_SPIN1_SPEED_rpm",
                    new_value=2000,  # same as current
                ),
            ],
            applied_by=setup_data["user"].id,
        )

        result = await apply_recipe_changes(
            db_session, setup_data["project"].id, request,
        )
        assert result.applied_count == 0

    @pytest.mark.asyncio
    async def test_apply_rejects_non_draft(self, db_session, setup_data):
        from fastapi import HTTPException

        setup_data["project"].status = "review"
        await db_session.commit()

        request = RecipeApplyRequest(
            changes=[
                RecipeApplyItem(
                    project_layer_id=setup_data["project_layer"].id,
                    column_name="SP_SPIN1_SPEED_rpm",
                    new_value=2100,
                ),
            ],
            applied_by=setup_data["user"].id,
        )

        with pytest.raises(HTTPException) as exc_info:
            await apply_recipe_changes(
                db_session, setup_data["project"].id, request,
            )
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_apply_creates_change_logs(self, db_session, setup_data):
        from sqlalchemy import select
        from app.models import ChangeLog

        request = RecipeApplyRequest(
            changes=[
                RecipeApplyItem(
                    project_layer_id=setup_data["project_layer"].id,
                    column_name="SP_SPIN1_SPEED_rpm",
                    new_value=3000,
                ),
            ],
            applied_by=setup_data["user"].id,
        )

        await apply_recipe_changes(db_session, setup_data["project"].id, request)

        # Check change_log entries
        logs_result = await db_session.execute(
            select(ChangeLog).where(
                ChangeLog.project_layer_id == setup_data["project_layer"].id,
                ChangeLog.change_type == "recipe",
            )
        )
        logs = logs_result.scalars().all()
        assert len(logs) == 1
        assert logs[0].column_name == "SP_SPIN1_SPEED_rpm"
        assert logs[0].old_value == "2000"
        assert logs[0].new_value == "3000"
