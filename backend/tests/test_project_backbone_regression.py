from __future__ import annotations

import copy

import pytest

from app.config import settings
from app.models import Layer, Line, Product, ProductLayer, Project, ProjectLayer, User
from app.services.project.service import create_project


@pytest.mark.asyncio
async def test_create_project_backbone_flow_not_affected_by_step_current_flag(db_session) -> None:
    """D4 regression check: legacy backbone flow should not depend on step_current settings."""
    line = Line(line_code="L-BB", line_name="Backbone Line")
    user = User(userid="u-bb", roles=["editor"], password_hash="", email="u-bb@test.local")
    db_session.add_all([line, user])
    await db_session.flush()

    layers = [
        Layer(layer_name="LAYER_A", step_seq="ts100000", layer_number="1.0", sort_order=10),
        Layer(layer_name="LAYER_B", step_seq="ts200000", layer_number="2.0", sort_order=20),
    ]
    db_session.add_all(layers)
    await db_session.flush()

    backbone = Product(product_name="BB-PROD", line_id=line.id, part_id="BB-PROD")
    target = Product(product_name="TG-PROD", line_id=line.id, part_id="TG-PROD")
    db_session.add_all([backbone, target])
    await db_session.flush()

    # target product layer mapping
    for layer in layers:
        db_session.add(ProductLayer(product_id=target.id, layer_id=layer.id, conditions={}))

    # backbone approved project + project layers (BackboneRepository source)
    approved = Project(
        product_id=backbone.id,
        main_backbone_id=backbone.id,
        status="approved",
        revision=1,
        is_latest=True,
        created_by=user.id,
    )
    db_session.add(approved)
    await db_session.flush()

    bb_conditions = [
        {"SP_SPIN1_SPEED_rpm": 2000, "SC_EXPOSE_ENERGY_mJ": 35.0},
        {"SP_SPIN1_SPEED_rpm": 2500, "SC_EXPOSE_ENERGY_mJ": 42.0},
    ]
    for layer, cond in zip(layers, bb_conditions):
        db_session.add(
            ProjectLayer(
                project_id=approved.id,
                layer_id=layer.layer_number,
                layer_name=layer.layer_name,
                step_seq=layer.step_seq,
                backbone_product_id=backbone.id,
                conditions=copy.deepcopy(cond),
                backbone_conditions=copy.deepcopy(cond),
                sort_order=layer.sort_order,
            )
        )
    await db_session.commit()

    prev_flag = settings.USE_STEP_CURRENT
    settings.USE_STEP_CURRENT = True
    try:
        project = await create_project(
            db=db_session,
            product_id=target.id,
            backbone_product_id=backbone.id,
            created_by=user.id,
        )
    finally:
        settings.USE_STEP_CURRENT = prev_flag

    assert project.status == "draft"
    assert len(project.layers) == 2
    sorted_layers = sorted(project.layers, key=lambda pl: pl.sort_order)
    assert sorted_layers[0].conditions == bb_conditions[0]
    assert sorted_layers[1].conditions == bb_conditions[1]
