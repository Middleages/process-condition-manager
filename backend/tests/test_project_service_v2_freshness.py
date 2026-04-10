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
            part_id="P1",
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
                process="PHOTO",
                part_id="P1",
                device_type="full",
                selected_layer_refs=[],
                backbone_condition_id=None,
                created_by=user.id,
            )
        assert exc_info.value.status_code == 503
        assert "freshness SLA breached" in caplog.text
    finally:
        settings.USE_STEP_CURRENT = prev_use
        settings.STEP_CURRENT_ENFORCE_FRESHNESS = prev_enforce
        settings.STEP_CURRENT_FRESHNESS_SLA_MINUTES = prev_sla


@pytest.mark.asyncio
async def test_create_project_v2_uses_step_current_even_when_flag_off(db_session) -> None:
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
        StepCurrent(
            line_id=line.id,
            process_id="PHOTO",
            part_id="P1",
            step_seq="ts100000",
            layer_id="1.0",
            step_name="S1",
            descript="Layer from step_current",
            raw_payload={},
        )
    )
    await db_session.commit()

    prev_use = settings.USE_STEP_CURRENT
    prev_enforce = settings.STEP_CURRENT_ENFORCE_FRESHNESS
    settings.USE_STEP_CURRENT = False
    settings.STEP_CURRENT_ENFORCE_FRESHNESS = False
    try:
        project = await create_project_v2(
            db_session,
            line_id=line.id,
            process="PHOTO",
            part_id="P1",
            device_type="full",
            selected_layer_refs=[],
            backbone_condition_id=None,
            created_by=user.id,
        )
        assert len(project.layers) == 1
        assert project.layers[0].layer_name == "Layer from step_current"
        assert project.layers[0].step_seq == "ts100000"
    finally:
        settings.USE_STEP_CURRENT = prev_use
        settings.STEP_CURRENT_ENFORCE_FRESHNESS = prev_enforce


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
            part_id="P1",
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
            process="PHOTO",
            part_id="P1",
            device_type="full",
            selected_layer_refs=[],
            backbone_condition_id=None,
            created_by=user.id,
        )
        assert len(project.layers) == 1
        assert project.layers[0].layer_name == "Layer from step_current"
        assert project.layers[0].step_seq == "ts100000"
    finally:
        settings.USE_STEP_CURRENT = prev_use
        settings.STEP_CURRENT_ENFORCE_FRESHNESS = prev_enforce
        settings.STEP_CURRENT_FRESHNESS_SLA_MINUTES = prev_sla


@pytest.mark.asyncio
async def test_create_project_v2_full_auto_selects_all_step_current_layers_when_empty_selection(db_session) -> None:
    line = Line(line_code="L-AUTO", line_name="Line Auto")
    user = User(userid="u-auto", roles=["editor"], password_hash="", email="u-auto@test.local")
    device = DeviceMaster(
        line=line,
        product_name="DEV-AUTO",
        process="PHOTO",
        part_id="P1",
        is_active=True,
        enrichment={},
    )
    db_session.add_all([line, user, device])
    await db_session.flush()
    db_session.add_all(
        [
            StepCurrent(
                line_id=line.id,
                process_id="PHOTO",
                part_id="P1",
                step_seq="ts100000",
                layer_id="1.0",
                step_name="S1",
                descript="Layer 1",
                raw_payload={},
            ),
            StepCurrent(
                line_id=line.id,
                process_id="PHOTO",
                part_id="P1",
                step_seq="ts200000",
                layer_id="2.0",
                step_name="S2",
                descript="Layer 2",
                raw_payload={},
            ),
        ]
    )
    db_session.add(
        EtlRunLog(
            dag_id="full_to_current_hourly",
            run_id="fresh-run-auto",
            status="success",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=20),
            finished_at=datetime.now(timezone.utc) - timedelta(minutes=10),
        )
    )
    await db_session.commit()

    prev_use = settings.USE_STEP_CURRENT
    prev_enforce = settings.STEP_CURRENT_ENFORCE_FRESHNESS
    settings.USE_STEP_CURRENT = True
    settings.STEP_CURRENT_ENFORCE_FRESHNESS = False
    try:
        project = await create_project_v2(
            db_session,
            line_id=line.id,
            process="PHOTO",
            part_id="P1",
            device_type="full",
            selected_layer_refs=[],
            backbone_condition_id=None,
            created_by=user.id,
        )
        assert sorted([pl.layer_id for pl in project.layers]) == ["1.0", "2.0"]
    finally:
        settings.USE_STEP_CURRENT = prev_use
        settings.STEP_CURRENT_ENFORCE_FRESHNESS = prev_enforce


@pytest.mark.asyncio
async def test_create_project_v2_uses_selected_layer_refs_as_primary_for_duplicate_layer_ids(db_session) -> None:
    line = Line(line_code="L-DUP", line_name="Line Dup")
    user = User(userid="u-dup", roles=["editor"], password_hash="", email="u-dup@test.local")
    device = DeviceMaster(
        line=line,
        product_name="DEV-DUP",
        process="PHOTO",
        part_id="P1",
        is_active=True,
        enrichment={},
    )
    db_session.add_all([line, user, device])
    await db_session.flush()
    db_session.add_all(
        [
            StepCurrent(
                line_id=line.id,
                process_id="PHOTO",
                part_id="P1",
                step_seq="ts100000",
                layer_id="1.0",
                step_name="S1",
                descript="Layer 1-A",
                raw_payload={},
            ),
            StepCurrent(
                line_id=line.id,
                process_id="PHOTO",
                part_id="P1",
                step_seq="ts100001",
                layer_id="1.0",
                step_name="S1b",
                descript="Layer 1-B",
                raw_payload={},
            ),
        ]
    )
    await db_session.commit()

    prev_use = settings.USE_STEP_CURRENT
    prev_enforce = settings.STEP_CURRENT_ENFORCE_FRESHNESS
    settings.USE_STEP_CURRENT = True
    settings.STEP_CURRENT_ENFORCE_FRESHNESS = False
    try:
        project = await create_project_v2(
            db_session,
            line_id=line.id,
            process="PHOTO",
            part_id="P1",
            device_type="short",
            selected_layer_refs=[("1.0", "ts100001")],
            backbone_condition_id=None,
            created_by=user.id,
        )
        assert len(project.layers) == 1
        assert project.layers[0].layer_id == "1.0"
        assert project.layers[0].step_seq == "ts100001"
        assert project.layers[0].layer_name == "Layer 1-B"
    finally:
        settings.USE_STEP_CURRENT = prev_use
        settings.STEP_CURRENT_ENFORCE_FRESHNESS = prev_enforce


@pytest.mark.asyncio
async def test_create_project_v2_short_requires_selected_layer_refs(db_session) -> None:
    line = Line(line_code="L-DUP-ERR", line_name="Line Dup Err")
    user = User(userid="u-dup-err", roles=["editor"], password_hash="", email="u-dup-err@test.local")
    device = DeviceMaster(
        line=line,
        product_name="DEV-DUP-ERR",
        process="PHOTO",
        part_id="P1",
        is_active=True,
        enrichment={},
    )
    db_session.add_all([line, user, device])
    await db_session.flush()
    db_session.add_all(
        [
            StepCurrent(
                line_id=line.id,
                process_id="PHOTO",
                part_id="P1",
                step_seq="ts100000",
                layer_id="1.0",
                step_name="S1",
                descript="Layer 1-A",
                raw_payload={},
            ),
            StepCurrent(
                line_id=line.id,
                process_id="PHOTO",
                part_id="P1",
                step_seq="ts100001",
                layer_id="1.0",
                step_name="S1b",
                descript="Layer 1-B",
                raw_payload={},
            ),
        ]
    )
    await db_session.commit()

    prev_use = settings.USE_STEP_CURRENT
    prev_enforce = settings.STEP_CURRENT_ENFORCE_FRESHNESS
    settings.USE_STEP_CURRENT = True
    settings.STEP_CURRENT_ENFORCE_FRESHNESS = False
    try:
        with pytest.raises(HTTPException) as exc_info:
            await create_project_v2(
                db_session,
                line_id=line.id,
                process="PHOTO",
                part_id="P1",
                device_type="short",
                selected_layer_refs=[],
                backbone_condition_id=None,
                created_by=user.id,
            )
        assert exc_info.value.status_code == 422
        assert "selected_layer_refs" in str(exc_info.value.detail)
    finally:
        settings.USE_STEP_CURRENT = prev_use
        settings.STEP_CURRENT_ENFORCE_FRESHNESS = prev_enforce
