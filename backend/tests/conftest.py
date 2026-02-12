import json
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from httpx import AsyncClient, ASGITransport

from app.database import Base, get_db
from app.main import app
from app.config import settings

# Use the same PostgreSQL instance with a test database
# Override via TEST_DATABASE_URL env or default to pcm_test
import os
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    settings.DATABASE_URL.replace("/pcm", "/pcm_test") if "/pcm" in settings.DATABASE_URL else settings.DATABASE_URL + "_test"
)

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(
    test_engine, class_=AsyncSession, expire_on_commit=False
)


@pytest_asyncio.fixture(scope="function")
async def db_session():
    """Create tables, yield session, drop tables after each test."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with TestSessionLocal() as session:
        yield session

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession):
    """Async test client with DB session override."""
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def seed_test_data(db_session: AsyncSession):
    """Insert minimal test data for service tests."""
    from app.models import User, Line, Product, Layer, ProductLayer, ColumnCategory, ColumnDefinition, ColumnValidation

    # User
    user = User(username="tester1", display_name="Test User", role="editor")
    db_session.add(user)
    await db_session.flush()

    # Line
    line = Line(line_code="TEST-LINE", line_name="Test Line")
    db_session.add(line)
    await db_session.flush()

    # Layers
    layers = []
    for i, (name, seq, num, order) in enumerate([
        ("LAYER_A", "ts100000", "1.0", 10),
        ("LAYER_B", "ts200000", "2.0", 20),
        ("LAYER_C", "ts300000", "3.0", 30),
    ]):
        layer = Layer(layer_name=name, step_seq=seq, layer_number=num, sort_order=order)
        db_session.add(layer)
        layers.append(layer)
    await db_session.flush()

    # Backbone product with 3 layers
    backbone = Product(
        product_name="BB-PROD", description="Backbone product",
        is_backbone=True, line_id=line.id, part_id="BB-PROD",
    )
    db_session.add(backbone)
    await db_session.flush()

    bb_conditions = [
        {"SP_SPIN1_SPEED_rpm": 2000, "SC_EXPOSE_ENERGY_mJ": 35.0, "SP_ADHESION_USE": "Y", "SP_ADHESION_TYPE": "HMDS"},
        {"SP_SPIN1_SPEED_rpm": 2500, "SC_EXPOSE_ENERGY_mJ": 42.0, "SP_ADHESION_USE": "N"},
        {"SP_SPIN1_SPEED_rpm": 1800, "SC_EXPOSE_ENERGY_mJ": 28.0, "SP_ADHESION_USE": "Y", "SP_ADHESION_TYPE": "AP3000"},
    ]
    for layer, cond in zip(layers, bb_conditions):
        pl = ProductLayer(product_id=backbone.id, layer_id=layer.id, conditions=cond)
        db_session.add(pl)

    # Non-backbone product with 3 layers (empty conditions)
    target = Product(
        product_name="NEW-PROD", description="Target product",
        is_backbone=False, line_id=line.id, part_id="NEW-PROD",
    )
    db_session.add(target)
    await db_session.flush()

    for layer in layers:
        pl = ProductLayer(product_id=target.id, layer_id=layer.id, conditions={})
        db_session.add(pl)

    # Non-backbone product with only 2 layers (partial overlap)
    partial = Product(
        product_name="PARTIAL-PROD", description="Partial layers product",
        is_backbone=False, line_id=line.id, part_id="PARTIAL-PROD",
    )
    db_session.add(partial)
    await db_session.flush()

    for layer in layers[:2]:
        pl = ProductLayer(product_id=partial.id, layer_id=layer.id, conditions={})
        db_session.add(pl)

    # Column categories & definitions for validation tests
    cat_sp = ColumnCategory(category_code="SP", category_name="Spin/PR", sort_order=1)
    cat_sc = ColumnCategory(category_code="SC", category_name="Scanner", sort_order=2)
    db_session.add_all([cat_sp, cat_sc])
    await db_session.flush()

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

    # Validation rules
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
        rule_config={"condition_column": "SP_ADHESION_USE", "condition_value": "Y", "operator": "equals"},
        error_message="Adhesion Use가 Y일 때 Adhesion Type은 필수입니다",
    )
    db_session.add_all([v_range_speed, v_range_energy, v_cond_req])
    await db_session.commit()

    return {
        "user": user,
        "line": line,
        "layers": layers,
        "backbone": backbone,
        "target": target,
        "partial": partial,
        "bb_conditions": bb_conditions,
    }
