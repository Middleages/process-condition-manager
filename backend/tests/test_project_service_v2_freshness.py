from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.config import settings
from app.models import DeviceMaster, EtlRunLog, LayerMaster, Line, StepCurrent, User
from app.services.project.service import create_project_v2


@pytest.mark.asyncio
async def test_create_project_v2_rejects_stale_step_current(db_session, caplog) -> None:
    line = Line(line_code="L-STEP", line_name="Step Line")
    user = User(userid="u-step", roles=["editor"], password_hash="", email="u-step@test.local")
    device = DeviceMaster(
        line=line,
        product_name="DEV-PROD",
        process="PHOTO",
        part_id="P1",
        is_active=True,
        enrichment={},
    )
    db_session.add_all([line, user, device])
    await db_session.flush()

    db_session.add(
        StepCurrent(
            line_id=line.id,
            process_id="PHOTO",
            step_seq="ts100000",
            layer_id="1.0",
            step_name="S1",
            descript="Layer 1",
            raw_payload={},
        )
    )
    db_session.add(
        EtlRunLog(
            dag_id="full_to_current_hourly",
            run_id="stale-run",
            status="success",
            started_at=datetime.now(timezone.utc) - timedelta(hours=3, minutes=10),
            finished_at=datetime.now(timezone.utc) - timedelta(hours=3),
        )
    )
    await db_session.commit()

    prev_use = settings.USE_STEP_CURRENT
    prev_enforce = settings.STEP_CURRENT_ENFORCE_FRESHNESS
    prev_sla = settings.STEP_CURRENT_FRESHNESS_SLA_MINUTES
    settings.USE_STEP_CURRENT = True
    settings.STEP_CURRENT_ENFORCE_FRESHNESS = True
    settings.STEP_CURRENT_FRESHNESS_SLA_MINUTES = 120
    try:
        with pytest.raises(HTTPException) as exc_info:
            await create_project_v2(
                db_session,
                line_id=line.id,
                product_name="DEV-PROD",
                process="PHOTO",
                part_id="P1",
                device_type="full",
                selected_layer_ids=["1.0"],
                backbone_product_id=None,
                created_by=user.id,
            )
        assert exc_info.value.status_code == 503
        assert "freshness SLA breached" in caplog.text
    finally:
        settings.USE_STEP_CURRENT = prev_use
        settings.STEP_CURRENT_ENFORCE_FRESHNESS = prev_enforce
        settings.STEP_CURRENT_FRESHNESS_SLA_MINUTES = prev_sla


@pytest.mark.asyncio
async def test_create_project_v2_uses_layer_master_when_flag_off(db_session) -> None:
    line = Line(line_code="L-OFF", line_name="Line Off")
    user = User(userid="u-off", roles=["editor"], password_hash="", email="u-off@test.local")
    device = DeviceMaster(
        line=line,
        product_name="DEV-OFF",
        process="PHOTO",
        part_id="P1",
        is_active=True,
        enrichment={},
    )
    db_session.add_all([line, user, device])
    await db_session.flush()
    db_session.add(
        LayerMaster(
            device_master_id=device.id,
            layer_id="1.0",
            step_seq="lm100000",
            descript="Layer from layer_master",
        )
    )
    db_session.add(
        StepCurrent(
            line_id=line.id,
            process_id="PHOTO",
            step_seq="ts100000",
            layer_id="1.0",
            step_name="S1",
            descript="Layer from step_current",
            raw_payload={},
        )
    )
    await db_session.commit()

    prev_use = settings.USE_STEP_CURRENT
    settings.USE_STEP_CURRENT = False
    try:
        project = await create_project_v2(
            db_session,
            line_id=line.id,
            product_name="DEV-OFF",
            process="PHOTO",
            part_id="P1",
            device_type="full",
            selected_layer_ids=["1.0"],
            backbone_product_id=None,
            created_by=user.id,
        )
        assert len(project.layers) == 1
        assert project.layers[0].layer_name == "Layer from layer_master"
        assert project.layers[0].step_seq == "lm100000"
    finally:
        settings.USE_STEP_CURRENT = prev_use


@pytest.mark.asyncio
async def test_create_project_v2_uses_step_current_when_flag_on_and_fresh(db_session) -> None:
    line = Line(line_code="L-ON", line_name="Line On")
    user = User(userid="u-on", roles=["editor"], password_hash="", email="u-on@test.local")
    device = DeviceMaster(
        line=line,
        product_name="DEV-ON",
        process="PHOTO",
        part_id="P1",
        is_active=True,
        enrichment={},
    )
    db_session.add_all([line, user, device])
    await db_session.flush()
    db_session.add(
        LayerMaster(
            device_master_id=device.id,
            layer_id="1.0",
            step_seq="lm100000",
            descript="Layer from layer_master",
        )
    )
    db_session.add(
        StepCurrent(
            line_id=line.id,
            process_id="PHOTO",
            step_seq="ts100000",
            layer_id="1.0",
            step_name="S1",
            descript="Layer from step_current",
            raw_payload={},
        )
    )
    db_session.add(
        EtlRunLog(
            dag_id="full_to_current_hourly",
            run_id="fresh-run",
            status="success",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=20),
            finished_at=datetime.now(timezone.utc) - timedelta(minutes=10),
        )
    )
    await db_session.commit()

    prev_use = settings.USE_STEP_CURRENT
    prev_enforce = settings.STEP_CURRENT_ENFORCE_FRESHNESS
    prev_sla = settings.STEP_CURRENT_FRESHNESS_SLA_MINUTES
    settings.USE_STEP_CURRENT = True
    settings.STEP_CURRENT_ENFORCE_FRESHNESS = True
    settings.STEP_CURRENT_FRESHNESS_SLA_MINUTES = 120
    try:
        project = await create_project_v2(
            db_session,
            line_id=line.id,
            product_name="DEV-ON",
            process="PHOTO",
            part_id="P1",
            device_type="full",
            selected_layer_ids=["1.0"],
            backbone_product_id=None,
            created_by=user.id,
        )
        assert len(project.layers) == 1
        assert project.layers[0].layer_name == "Layer from step_current"
        assert project.layers[0].step_seq == "ts100000"
    finally:
        settings.USE_STEP_CURRENT = prev_use
        settings.STEP_CURRENT_ENFORCE_FRESHNESS = prev_enforce
        settings.STEP_CURRENT_FRESHNESS_SLA_MINUTES = prev_sla
