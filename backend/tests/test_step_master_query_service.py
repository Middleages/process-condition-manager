from datetime import datetime, timedelta, timezone

import pytest

from app.models import EtlRunLog, Line, StepCurrent
from app.services.step_master.query_service import (
    get_last_successful_full_sync_at,
    get_step_layers,
    is_within_freshness_sla,
    list_part_ids,
)


def test_is_within_freshness_sla() -> None:
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    assert is_within_freshness_sla(
        last_success_at=now - timedelta(minutes=30),
        now_utc=now,
        sla_minutes=120,
    )
    assert not is_within_freshness_sla(
        last_success_at=now - timedelta(minutes=121),
        now_utc=now,
        sla_minutes=120,
    )
    assert not is_within_freshness_sla(
        last_success_at=None,
        now_utc=now,
        sla_minutes=120,
    )


@pytest.mark.asyncio
async def test_get_last_successful_full_sync_at(db_session) -> None:
    db_session.add_all(
        [
            EtlRunLog(
                dag_id="full_to_current_hourly",
                run_id="r1",
                status="failed",
                started_at=datetime.now(timezone.utc) - timedelta(hours=3),
                finished_at=datetime.now(timezone.utc) - timedelta(hours=3),
            ),
            EtlRunLog(
                dag_id="full_to_current_hourly",
                run_id="r2",
                status="success",
                started_at=datetime.now(timezone.utc) - timedelta(hours=2),
                finished_at=datetime.now(timezone.utc) - timedelta(hours=2),
            ),
            EtlRunLog(
                dag_id="full_to_current_hourly",
                run_id="r3",
                status="success",
                started_at=datetime.now(timezone.utc) - timedelta(hours=1),
                finished_at=datetime.now(timezone.utc) - timedelta(hours=1),
            ),
        ]
    )
    await db_session.commit()

    latest = await get_last_successful_full_sync_at(db_session)
    assert latest is not None


@pytest.mark.asyncio
async def test_get_step_layers_serves_step_current_rows_sorted(db_session) -> None:
    line = Line(line_code="L-SERVE", line_name="Serve Line")
    db_session.add(line)
    await db_session.flush()

    db_session.add_all(
        [
            StepCurrent(
                line_id=line.id,
                process_id="PHOTO",
                part_id="P-001",
                step_seq="ts200000",
                layer_id="2.0",
                step_name="S2",
                descript="Layer 2",
                raw_payload={},
            ),
            StepCurrent(
                line_id=line.id,
                process_id="PHOTO",
                part_id="P-001",
                step_seq="ts100000",
                layer_id="1.0",
                step_name="S1",
                descript="Layer 1",
                raw_payload={},
            ),
        ]
    )
    await db_session.commit()

    rows = await get_step_layers(db_session, line.id, "PHOTO", "P-001")
    assert [r.layer_id for r in rows] == ["1.0", "2.0"]
    assert [r.step_seq for r in rows] == ["ts100000", "ts200000"]


@pytest.mark.asyncio
async def test_list_part_ids_distinct_sorted(db_session) -> None:
    line = Line(line_code="L-PART", line_name="Part Line")
    db_session.add(line)
    await db_session.flush()

    db_session.add_all([
        StepCurrent(line_id=line.id, process_id="PHOTO", part_id="P-002", step_seq="1", layer_id="1.0", raw_payload={}),
        StepCurrent(line_id=line.id, process_id="PHOTO", part_id="P-001", step_seq="2", layer_id="2.0", raw_payload={}),
        StepCurrent(line_id=line.id, process_id="PHOTO", part_id="P-001", step_seq="3", layer_id="3.0", raw_payload={}),
    ])
    await db_session.commit()

    part_ids = await list_part_ids(db_session, line.id, "PHOTO")
    assert part_ids == ["P-001", "P-002"]
