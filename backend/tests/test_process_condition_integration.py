from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.config import settings
from app.models import Line, User
from app.models.step_master import StepCurrent
from app.services.project.service import create_project_v2, revise_project


@pytest.mark.asyncio
async def test_create_process_condition_blocks_active_duplicate_by_natural_key(db_session) -> None:
    line = Line(line_code="L-NK", line_name="NaturalKey Line")
    user = User(userid="pc_editor", roles=["editor"], password_hash="", email="pc_editor@test.local")
    db_session.add_all([line, user])
    await db_session.flush()

    db_session.add_all(
        [
            StepCurrent(
                line_id=line.id,
                process_id="PHOTO",
                part_id="PART-A",
                layer_id="1.0",
                step_seq="ts100000",
                step_name="STEP-A",
                descript="Layer A",
                source_updated_at=None,
                raw_payload={},
            ),
            StepCurrent(
                line_id=line.id,
                process_id="PHOTO",
                part_id="PART-A",
                layer_id="2.0",
                step_seq="ts200000",
                step_name="STEP-B",
                descript="Layer B",
                source_updated_at=None,
                raw_payload={},
            ),
        ]
    )
    await db_session.commit()

    prev_flag = settings.STEP_CURRENT_ENFORCE_FRESHNESS
    settings.STEP_CURRENT_ENFORCE_FRESHNESS = False
    try:
        await create_project_v2(
            db=db_session,
            line_id=line.id,
            process="PHOTO",
            part_id="PART-A",
            device_type="full",
            selected_layer_refs=[],
            backbone_condition_id=None,
            created_by=user.id,
        )
        with pytest.raises(HTTPException) as exc_info:
            await create_project_v2(
                db=db_session,
                line_id=line.id,
                process="PHOTO",
                part_id="PART-A",
                device_type="full",
                selected_layer_refs=[],
                backbone_condition_id=None,
                created_by=user.id,
            )
        assert exc_info.value.status_code == 409
    finally:
        settings.STEP_CURRENT_ENFORCE_FRESHNESS = prev_flag


@pytest.mark.asyncio
async def test_revise_process_condition_increments_revision_and_switches_latest(db_session) -> None:
    line = Line(line_code="L-REV", line_name="Revision Line")
    user = User(userid="pc_reviewer", roles=["reviewer"], password_hash="", email="pc_reviewer@test.local")
    db_session.add_all([line, user])
    await db_session.flush()

    db_session.add(
        StepCurrent(
            line_id=line.id,
            process_id="ETCH",
            part_id="PART-R1",
            layer_id="1.0",
            step_seq="ts110000",
            step_name="STEP-R",
            descript="Layer R",
            source_updated_at=None,
            raw_payload={},
        )
    )
    await db_session.commit()

    prev_flag = settings.STEP_CURRENT_ENFORCE_FRESHNESS
    settings.STEP_CURRENT_ENFORCE_FRESHNESS = False
    try:
        original = await create_project_v2(
            db=db_session,
            line_id=line.id,
            process="ETCH",
            part_id="PART-R1",
            device_type="full",
            selected_layer_refs=[],
            backbone_condition_id=None,
            created_by=user.id,
        )
        original.status = "approved"
        await db_session.commit()

        revised = await revise_project(db_session, original.id, revision_reason="integration test revise")

        await db_session.refresh(original)
        assert revised.revision == 2
        assert revised.parent_project_id == original.id
        assert revised.is_latest is True
        assert original.is_latest is False
        assert original.status == "archived"
    finally:
        settings.STEP_CURRENT_ENFORCE_FRESHNESS = prev_flag
