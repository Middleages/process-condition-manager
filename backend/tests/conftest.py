"""
Test configuration and fixtures for PCM backend tests.

Uses SQLite (async via aiosqlite) for test isolation and speed.
PostgreSQL-specific types (JSONB) are remapped to JSON for SQLite compatibility.
"""

import pytest
import pytest_asyncio
from datetime import datetime, timezone

from sqlalchemy import JSON, event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.dialects.postgresql import JSONB
from httpx import AsyncClient, ASGITransport

from app.database import Base, get_db
from app.main import app


# ---------------------------------------------------------------------------
# SQLite async engine for testing
# ---------------------------------------------------------------------------

SQLITE_URL = "sqlite+aiosqlite:///:memory:"


@event.listens_for(Base.metadata, "column_reflect")
def _remap_jsonb(inspector, table, column_info):
    """Remap JSONB columns to plain JSON when reflected (not strictly needed
    for create_all but kept as a safety net)."""
    if isinstance(column_info.get("type"), JSONB):
        column_info["type"] = JSON()


def _compile_jsonb_as_json(element, compiler, **kwargs):
    """Render PostgreSQL JSONB as plain JSON for SQLite."""
    return compiler.visit_JSON(element, **kwargs)


# ---------------------------------------------------------------------------
# Engine & session fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(scope="function")
async def db_session():
    """
    Per-test async session backed by an in-memory SQLite database.

    * Creates all tables before each test.
    * Drops all tables after each test to guarantee isolation.
    """
    engine = create_async_engine(SQLITE_URL, echo=False)

    # Register a compile rule so JSONB is treated as JSON on SQLite
    from sqlalchemy.ext.compiler import compiles as _compiles
    _compiles(JSONB, "sqlite")(_compile_jsonb_as_json)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False,
    )

    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession):
    """Async HTTP test client with the DB session overridden."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Seed data fixture
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def seed_test_data(db_session: AsyncSession):
    """
    Insert minimal but realistic test data covering:
    - 1 user
    - 1 line
    - 3 layers (LAYER_A, LAYER_B, LAYER_C)
    - 1 backbone product with conditions on all 3 layers
    - 1 target product with empty conditions on 3 layers
    - 1 partial product with 2 layers
    - 2 column categories (SP, SC)
    - 4 column definitions (2 required, 2 optional-ish)
    - 3 validation rules (range x2, conditional_required x1)
    """
    from app.models import (
        User, Line, Product, Layer, ProductLayer,
        ColumnCategory, ColumnDefinition, ColumnValidation,
    )

    # -- Users --
    user = User(username="tester1", display_name="Test User", role="editor")
    admin_user = User(username="admin1", display_name="Admin User", role="admin")
    db_session.add_all([user, admin_user])
    await db_session.flush()

    # -- Line --
    line = Line(line_code="TEST-LINE", line_name="Test Line")
    db_session.add(line)
    await db_session.flush()

    # -- Layers --
    layers = []
    for name, seq, num, order in [
        ("LAYER_A", "ts100000", "1.0", 10),
        ("LAYER_B", "ts200000", "2.0", 20),
        ("LAYER_C", "ts300000", "3.0", 30),
    ]:
        layer = Layer(
            layer_name=name, step_seq=seq,
            layer_number=num, sort_order=order,
        )
        db_session.add(layer)
        layers.append(layer)
    await db_session.flush()

    # -- Backbone product (is_backbone=True) with 3 layers --
    backbone = Product(
        product_name="BB-PROD", description="Backbone product",
        is_backbone=True, line_id=line.id, part_id="BB-PROD",
    )
    db_session.add(backbone)
    await db_session.flush()

    bb_conditions = [
        {
            "SP_SPIN1_SPEED_rpm": 2000,
            "SC_EXPOSE_ENERGY_mJ": 35.0,
            "SP_ADHESION_USE": "Y",
            "SP_ADHESION_TYPE": "HMDS",
        },
        {
            "SP_SPIN1_SPEED_rpm": 2500,
            "SC_EXPOSE_ENERGY_mJ": 42.0,
            "SP_ADHESION_USE": "N",
        },
        {
            "SP_SPIN1_SPEED_rpm": 1800,
            "SC_EXPOSE_ENERGY_mJ": 28.0,
            "SP_ADHESION_USE": "Y",
            "SP_ADHESION_TYPE": "AP3000",
        },
    ]
    for layer, cond in zip(layers, bb_conditions):
        pl = ProductLayer(product_id=backbone.id, layer_id=layer.id, conditions=cond)
        db_session.add(pl)

    # -- Target product (is_backbone=False) with 3 layers, empty conditions --
    target = Product(
        product_name="NEW-PROD", description="Target product",
        is_backbone=False, line_id=line.id, part_id="NEW-PROD",
    )
    db_session.add(target)
    await db_session.flush()

    for layer in layers:
        pl = ProductLayer(product_id=target.id, layer_id=layer.id, conditions={})
        db_session.add(pl)

    # -- Partial product with only 2 layers --
    partial = Product(
        product_name="PARTIAL-PROD", description="Partial layers product",
        is_backbone=False, line_id=line.id, part_id="PARTIAL-PROD",
    )
    db_session.add(partial)
    await db_session.flush()

    for layer in layers[:2]:
        pl = ProductLayer(product_id=partial.id, layer_id=layer.id, conditions={})
        db_session.add(pl)

    # -- Column categories --
    cat_sp = ColumnCategory(category_code="SP", category_name="Spin/PR", sort_order=1)
    cat_sc = ColumnCategory(category_code="SC", category_name="Scanner", sort_order=2)
    db_session.add_all([cat_sp, cat_sc])
    await db_session.flush()

    # -- Column definitions --
    col_speed = ColumnDefinition(
        column_name="SP_SPIN1_SPEED_rpm", display_name="Spin1 Speed",
        category_id=cat_sp.id, data_type="integer", sort_order=1, is_required=True,
    )
    col_energy = ColumnDefinition(
        column_name="SC_EXPOSE_ENERGY_mJ", display_name="Expose Energy",
        category_id=cat_sc.id, data_type="float", sort_order=1, is_required=True,
    )
    col_adhesion_use = ColumnDefinition(
        column_name="SP_ADHESION_USE", display_name="Adhesion Use",
        category_id=cat_sp.id, data_type="select", sort_order=2, is_required=True,
    )
    col_adhesion_type = ColumnDefinition(
        column_name="SP_ADHESION_TYPE", display_name="Adhesion Type",
        category_id=cat_sp.id, data_type="select", sort_order=3, is_required=False,
    )
    db_session.add_all([col_speed, col_energy, col_adhesion_use, col_adhesion_type])
    await db_session.flush()

    # -- Validation rules --
    v_range_speed = ColumnValidation(
        column_id=col_speed.id, rule_type="range",
        rule_config={"min": 500, "max": 8000},
        error_message="Spin1 Speed는 500~8000 rpm 범위여야 합니다",
    )
    v_range_energy = ColumnValidation(
        column_id=col_energy.id, rule_type="range",
        rule_config={"min": 1.0, "max": 200.0},
        error_message="노광 에너지는 1~200mJ 범위여야 합니다",
    )
    v_cond_req = ColumnValidation(
        column_id=col_adhesion_type.id, rule_type="conditional_required",
        rule_config={
            "condition_column": "SP_ADHESION_USE",
            "condition_value": "Y",
            "operator": "equals",
        },
        error_message="Adhesion Use가 Y일 때 Adhesion Type은 필수입니다",
    )
    db_session.add_all([v_range_speed, v_range_energy, v_cond_req])
    await db_session.commit()

    return {
        "user": user,
        "admin_user": admin_user,
        "line": line,
        "layers": layers,
        "backbone": backbone,
        "target": target,
        "partial": partial,
        "bb_conditions": bb_conditions,
    }
