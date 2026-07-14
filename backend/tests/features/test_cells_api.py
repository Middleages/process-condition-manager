"""셀 편집 저장 API 테스트 (P2-T3).

- 정상 저장: 여러 셀 배치 → 서버 확정 값 + change_event(cell_update) 구조화 컬럼
- 변경 없는 셀(같은 값/공백만 다른 값 재저장)은 이벤트 미생성
- 빈 문자열/공백 → null 정규화 (기존 값 비우기 = 행 유지 + value_text=None,
  신규 빈 값 = 변경 없음이라 행/이벤트 없음)
- 타 프로젝트 condition_id 포함 시 전체 거부(422) + 부분 저장 없음
- 잠금 없이/틀린 토큰 호출 시 409, 보유 시 통과
- 존재하지 않는 project_id → 404 (미존재 프로젝트에 잠금을 직접 심어 서비스의
  404 경로를 격리 검증 — SQLite 테스트는 FK 미강제)
- 빈 cells 리스트 → no-op 200

인증 스텁이 항상 dev-admin을 반환하므로 세션 구분은 lock_token으로만 이뤄진다.
"""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.parameters.types import ValueType
from app.models.choice import ChoiceSet
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    EditLock,
    LayerCondition,
    Project,
    ProjectStatus,
    SheetLayer,
)
from tests.factories import seed_choice_set, seed_parameter


async def _seed_project(
    session: AsyncSession, *, process_id: str = "PROC_X", part_id: str = "P1"
) -> tuple[int, int, int]:
    """1 layer / 2 조건 행 프로젝트를 심는다.

    cond1엔 초기 셀(spin_speed=1200)을 둬 변경/비우기/무변경을 검증한다.
    cond2는 비어 있어 신규 삽입을 검증한다. 반환: (project_id, cond1_id, cond2_id).
    """
    project = Project(
        line_id="L1",
        process_id=process_id,
        part_id=part_id,
        name="cells test",
        status=ProjectStatus.DRAFT,
    )
    layer = SheetLayer(
        layer_key=f"L1::{process_id}::010::ACT",
        step_seq="010",
        layer_id="ACT",
        sort_order=1,
    )
    cond1 = LayerCondition(label="base", condition_index=1, is_por=True)
    cond1.cell_values.append(CellValue(parameter_code="spin_speed", value_text="1200"))
    cond2 = LayerCondition(label="C2", condition_index=2, is_por=False)
    layer.conditions.extend([cond1, cond2])
    project.layers.append(layer)
    session.add(project)
    await session.flush()
    ids = (project.id, cond1.id, cond2.id)
    await session.commit()
    return ids


async def _seed_lock(
    session: AsyncSession,
    project_id: int,
    *,
    token: str,
    locked_by: str = "dev-admin",
    minutes: int = 5,
) -> None:
    """edit_lock 행을 직접 심는다 (미존재 프로젝트에도 — FK 미강제 테스트 전제)."""
    now = datetime.now(UTC)
    session.add(
        EditLock(
            project_id=project_id,
            locked_by=locked_by,
            lock_token=token,
            locked_at=now,
            expires_at=now + timedelta(minutes=minutes),
        )
    )
    await session.commit()


async def _seed_parameters(session: AsyncSession) -> None:
    """타입 검증 대상 파라미터를 레지스트리에 심는다.

    - temp_c: number (canonical decimal parsing 대상)
    - pr_type: managed choice (활성 A/B/AUTO, 비활성 LEGACY)
    - memo: text (제약 없음 — 어떤 문자열이든 통과)

    셀·이벤트는 code로만 파라미터를 참조하므로(FK 아님) 여기 없는 code는 검증에서
    빠진다. db_client/db_session이 같은 엔진을 공유하니 커밋 후 API에서 읽힌다.
    """
    number_param = await seed_parameter(
        session,
        code="temp_c",
        value_type=ValueType.NUMBER,
    )
    number_param.display_name = "온도(C)"
    text_param = await seed_parameter(
        session,
        code="memo",
        value_type=ValueType.TEXT,
    )
    text_param.display_name = "메모"
    choice_set = await seed_choice_set(
        session,
        code="equipment_mode",
        options=(
            ("A", "Type A", True),
            ("B", "Type B", True),
            ("AUTO", "Automatic", True),
            ("LEGACY", "폐기", False),
        ),
    )
    choice_param = await seed_parameter(
        session,
        code="pr_type",
        value_type=ValueType.CHOICE,
        choice_set=choice_set,
    )
    choice_param.display_name = "PR 종류"
    await session.commit()


async def _acquire(client: AsyncClient, project_id: int) -> str:
    resp = await client.post(f"/api/projects/{project_id}/lock")
    assert resp.status_code == 200, resp.text
    return resp.json()["lock_token"]


async def _patch(
    client: AsyncClient,
    project_id: int,
    cells: list[dict],
    *,
    token: str | None = None,
    origin: str = "manual",
) -> Response:
    headers = {"X-Lock-Token": token} if token is not None else {}
    return await client.patch(
        f"/api/projects/{project_id}/cells",
        json={"cells": cells, "origin": origin},
        headers=headers,
    )


async def _cell_value(
    session: AsyncSession, condition_id: int, parameter_code: str
) -> tuple[bool, str | None]:
    """(행 존재 여부, value_text). 세션 캐시를 비워 커밋된 최신 상태를 읽는다."""
    session.expire_all()
    row = (
        await session.execute(
            select(CellValue).where(
                CellValue.condition_id == condition_id,
                CellValue.parameter_code == parameter_code,
            )
        )
    ).scalar_one_or_none()
    return (row is not None, row.value_text if row is not None else None)


async def _cell_events(session: AsyncSession, project_id: int) -> list[ChangeEvent]:
    """프로젝트의 cell_update 이벤트를 id 순으로 조회한다."""
    session.expire_all()
    rows = await session.execute(
        select(ChangeEvent)
        .where(
            ChangeEvent.project_id == project_id,
            ChangeEvent.event_type == ChangeEventType.CELL_UPDATE,
        )
        .order_by(ChangeEvent.id)
    )
    return list(rows.scalars().all())


# --- 정상 저장 --------------------------------------------------------------


async def test_patch_cells_saves_and_records_events(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, cond1, cond2 = await _seed_project(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        [
            {"condition_id": cond1, "parameter_code": "spin_speed", "value": "1500"},  # 변경
            {"condition_id": cond1, "parameter_code": "pr_type", "value": "A"},  # 신규
            {"condition_id": cond2, "parameter_code": "spin_speed", "value": "900"},  # 신규
        ],
        token=token,
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["batch_id"]
    # 응답은 셀별 서버 확정 값을 그대로 돌려준다.
    values = {(c["condition_id"], c["parameter_code"]): c["value"] for c in body["cells"]}
    assert values == {
        (cond1, "spin_speed"): "1500",
        (cond1, "pr_type"): "A",
        (cond2, "spin_speed"): "900",
    }

    # cell_value 반영 확인.
    assert (await _cell_value(db_session, cond1, "spin_speed"))[1] == "1500"
    assert (await _cell_value(db_session, cond1, "pr_type"))[1] == "A"
    assert (await _cell_value(db_session, cond2, "spin_speed"))[1] == "900"

    # 이벤트 3건 — 전부 cell_update, 같은 batch_id, origin=manual, actor=dev-admin.
    events = await _cell_events(db_session, project_id)
    assert len(events) == 3
    assert {e.payload["batch_id"] for e in events} == {body["batch_id"]}
    assert {e.payload["origin"] for e in events} == {"manual"}
    assert {e.actor for e in events} == {"dev-admin"}
    # 구조화 컬럼(old/new)이 셀 단위로 정확히 남는다.
    by_key = {(e.condition_id, e.parameter_code): e for e in events}
    assert (by_key[(cond1, "spin_speed")].old_value, by_key[(cond1, "spin_speed")].new_value) == (
        "1200",
        "1500",
    )
    assert (by_key[(cond1, "pr_type")].old_value, by_key[(cond1, "pr_type")].new_value) == (
        None,
        "A",
    )
    assert (by_key[(cond2, "spin_speed")].old_value, by_key[(cond2, "spin_speed")].new_value) == (
        None,
        "900",
    )


async def test_patch_cells_paste_origin_recorded(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """origin=paste가 이벤트 payload에 실린다 (Phase 4 붙여넣기 묶음 근거)."""
    project_id, cond1, _ = await _seed_project(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "spin_speed", "value": "1500"}],
        token=token,
        origin="paste",
    )

    assert resp.status_code == 200, resp.text
    events = await _cell_events(db_session, project_id)
    assert len(events) == 1
    assert events[0].payload["origin"] == "paste"


# --- 변경 없는 셀 -----------------------------------------------------------


async def test_patch_cells_unchanged_value_records_no_event(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, cond1, _ = await _seed_project(db_session)
    token = await _acquire(db_client, project_id)

    # 같은 값(1200) 재저장 → 변경 없음.
    same = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "spin_speed", "value": "1200"}],
        token=token,
    )
    assert same.status_code == 200, same.text
    assert same.json()["cells"][0]["value"] == "1200"

    # 앞뒤 공백만 다른 값도 정규화 후 동일 → 여전히 변경 없음.
    trimmed = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "spin_speed", "value": "  1200  "}],
        token=token,
    )
    assert trimmed.status_code == 200, trimmed.text

    # 두 번의 무변경 저장 모두 이벤트를 남기지 않는다.
    assert await _cell_events(db_session, project_id) == []
    assert (await _cell_value(db_session, cond1, "spin_speed"))[1] == "1200"


# --- 빈 값 정규화 -----------------------------------------------------------


async def test_patch_cells_empty_string_normalizes_to_null(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, cond1, cond2 = await _seed_project(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        [
            # 기존 값(1200)을 공백으로 비운다.
            {"condition_id": cond1, "parameter_code": "spin_speed", "value": "   "},
            # 신규 셀에 빈 문자열 — 정규화하면 값 없음.
            {"condition_id": cond2, "parameter_code": "pr_type", "value": ""},
            # value가 이미 None인 신규 셀.
            {"condition_id": cond2, "parameter_code": "spin_speed", "value": None},
        ],
        token=token,
    )

    assert resp.status_code == 200, resp.text
    # 응답: 셋 다 null로 확정.
    values = {(c["condition_id"], c["parameter_code"]): c["value"] for c in resp.json()["cells"]}
    assert values == {
        (cond1, "spin_speed"): None,
        (cond2, "pr_type"): None,
        (cond2, "spin_speed"): None,
    }

    # 기존 값 비우기: 행은 유지되고 value_text=None.
    exists, value = await _cell_value(db_session, cond1, "spin_speed")
    assert exists is True
    assert value is None

    # 신규 빈 값(None→None)은 반영할 것이 없어 행을 만들지 않는다.
    assert (await _cell_value(db_session, cond2, "pr_type"))[0] is False
    assert (await _cell_value(db_session, cond2, "spin_speed"))[0] is False

    # 이벤트: 실제 변경(기존 값 비우기)만 1건.
    events = await _cell_events(db_session, project_id)
    assert len(events) == 1
    assert events[0].condition_id == cond1
    assert events[0].parameter_code == "spin_speed"
    assert events[0].old_value == "1200"
    assert events[0].new_value is None


# --- 타 프로젝트 조건 거부 --------------------------------------------------


async def test_patch_cells_rejects_condition_from_other_project(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_a, cond_a, _ = await _seed_project(db_session, process_id="PROC_X", part_id="A")
    _, cond_b, _ = await _seed_project(db_session, process_id="PROC_Y", part_id="B")
    token = await _acquire(db_client, project_a)

    # A의 유효 셀 + B의 조건을 섞어 보낸다 → 하나라도 소속 아니면 전체 거부.
    resp = await _patch(
        db_client,
        project_a,
        [
            {"condition_id": cond_a, "parameter_code": "spin_speed", "value": "1500"},
            {"condition_id": cond_b, "parameter_code": "spin_speed", "value": "42"},
        ],
        token=token,
    )

    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "validation_error"
    assert cond_b in body["details"]["invalid_condition_ids"]

    # 전체 거부 — A의 유효 셀도 저장되지 않고 이벤트도 없다 (원값 유지).
    assert await _cell_events(db_session, project_a) == []
    assert (await _cell_value(db_session, cond_a, "spin_speed"))[1] == "1200"


# --- 잠금 검사 --------------------------------------------------------------


async def test_patch_cells_requires_lock(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, cond1, _ = await _seed_project(db_session)
    cells = [{"condition_id": cond1, "parameter_code": "spin_speed", "value": "1500"}]

    # 잠금 없이 호출 → 409.
    no_lock = await _patch(db_client, project_id, cells)
    assert no_lock.status_code == 409
    assert no_lock.json()["code"] == "lock_conflict"

    # 잠금 보유(토큰 헤더) → 통과.
    token = await _acquire(db_client, project_id)
    ok = await _patch(db_client, project_id, cells, token=token)
    assert ok.status_code == 200, ok.text
    assert (await _cell_value(db_session, cond1, "spin_speed"))[1] == "1500"


async def test_patch_cells_wrong_token_conflicts(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, cond1, _ = await _seed_project(db_session)
    await _acquire(db_client, project_id)  # 유효 잠금은 있으나 다른 토큰으로 시도.

    resp = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "spin_speed", "value": "1500"}],
        token="not-the-real-token",
    )

    assert resp.status_code == 409
    assert resp.json()["code"] == "lock_conflict"
    # 거부된 편집은 반영되지 않는다.
    assert (await _cell_value(db_session, cond1, "spin_speed"))[1] == "1200"


# --- 미존재 프로젝트 / no-op ------------------------------------------------


async def test_patch_cells_unknown_project_returns_404(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    # 미존재 프로젝트에 유효 잠금을 직접 심어 require_edit_lock을 통과시킨 뒤,
    # 서비스의 존재 확인(404) 경로를 격리 검증한다.
    missing_id = 999999
    await _seed_lock(db_session, missing_id, token="ghost-token")

    resp = await _patch(
        db_client,
        missing_id,
        [{"condition_id": 1, "parameter_code": "spin_speed", "value": "1"}],
        token="ghost-token",
    )

    assert resp.status_code == 404
    assert resp.json()["code"] == "not_found"


async def test_patch_cells_empty_list_is_noop(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _, _ = await _seed_project(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(db_client, project_id, [], token=token)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["cells"] == []
    assert body["batch_id"]
    assert await _cell_events(db_session, project_id) == []


# --- 타입 정합성 최종 검증 (P2-T4) ------------------------------------------
# 붙여넣기는 셀 에디터를 거치지 않고 원시 문자열을 꽂으므로, 저장 시 서버가
# 레지스트리 기준 value_type(number 파싱/choice 옵션 일치)만 최종 확인한다.
# range/required/pattern 등은 Phase 3의 몫이라 여기서 보지 않는다.


async def test_patch_cells_rejects_non_numeric_for_number_param(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, cond1, _ = await _seed_project(db_session)
    await _seed_parameters(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "temp_c", "value": "abc"}],
        token=token,
    )

    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "validation_error"
    # 위반 상세에 해당 셀이 그대로(정규화된 값 포함) 담긴다.
    assert body["details"]["invalid_cells"] == [
        {
            "condition_id": cond1,
            "parameter_code": "temp_c",
            "value": "abc",
            "reason": "invalid_number",
        }
    ]
    # 전체 거부 — 셀·이벤트 미반영.
    assert (await _cell_value(db_session, cond1, "temp_c"))[0] is False
    assert await _cell_events(db_session, project_id) == []


async def test_patch_cells_rejects_comma_formatted_decimal(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """콤마 포함 서식("1,234")은 canonical decimal 문법 밖이라 거부된다."""
    project_id, cond1, _ = await _seed_project(db_session)
    await _seed_parameters(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "temp_c", "value": "1,234"}],
        token=token,
    )

    assert resp.status_code == 422, resp.text
    reasons = [c["reason"] for c in resp.json()["details"]["invalid_cells"]]
    assert reasons == ["invalid_number"]
    assert (await _cell_value(db_session, cond1, "temp_c"))[0] is False


async def test_patch_cells_accepts_valid_number(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """유효한 정수/실수 문자열은 통과해 그대로 저장된다."""
    project_id, cond1, cond2 = await _seed_project(db_session)
    await _seed_parameters(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        [
            {"condition_id": cond1, "parameter_code": "temp_c", "value": "1500"},
            {"condition_id": cond2, "parameter_code": "temp_c", "value": "12.5"},
        ],
        token=token,
    )

    assert resp.status_code == 200, resp.text
    assert (await _cell_value(db_session, cond1, "temp_c"))[1] == "1500"
    assert (await _cell_value(db_session, cond2, "temp_c"))[1] == "12.5"


async def test_number_write_returns_and_stores_canonical_value(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, cond1, _ = await _seed_project(db_session)
    await _seed_parameters(db_session)
    token = await _acquire(db_client, project_id)

    response = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "temp_c", "value": " 001.5000 "}],
        token=token,
    )

    assert response.status_code == 200, response.text
    assert response.json()["cells"][0]["value"] == "1.5"
    assert (await _cell_value(db_session, cond1, "temp_c"))[1] == "1.5"


async def test_patch_cells_accepts_any_text_for_text_param(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """text 파라미터는 제약이 없어 숫자로 안 읽히는 값이라도 그대로 통과한다."""
    project_id, cond1, _ = await _seed_project(db_session)
    await _seed_parameters(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "memo", "value": "  1,234 abc  "}],
        token=token,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["cells"][0]["value"] == "1,234 abc"
    assert (await _cell_value(db_session, cond1, "memo"))[1] == "1,234 abc"


@pytest.mark.parametrize("origin", ["manual", "paste"])
async def test_patch_cells_rejects_unknown_choice_for_every_origin(
    db_client: AsyncClient, db_session: AsyncSession, origin: str
) -> None:
    """옵션 목록에 없는 값은 거부된다."""
    project_id, cond1, _ = await _seed_project(db_session)
    await _seed_parameters(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "pr_type", "value": "Z"}],
        token=token,
        origin=origin,
    )

    assert resp.status_code == 422, resp.text
    assert resp.json()["details"]["invalid_cells"] == [
        {
            "condition_id": cond1,
            "parameter_code": "pr_type",
            "value": "Z",
            "reason": "invalid_choice",
        }
    ]
    assert (await _cell_value(db_session, cond1, "pr_type"))[0] is False


async def test_patch_cells_accepts_valid_choice(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """활성 옵션 값은 통과해 그대로 저장된다."""
    project_id, cond1, _ = await _seed_project(db_session)
    await _seed_parameters(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "pr_type", "value": "A"}],
        token=token,
    )

    assert resp.status_code == 200, resp.text
    assert (await _cell_value(db_session, cond1, "pr_type"))[1] == "A"


async def test_choice_event_snapshots_labels(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, cond1, _ = await _seed_project(db_session)
    await _seed_parameters(db_session)
    token = await _acquire(db_client, project_id)

    response = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "pr_type", "value": "AUTO"}],
        token=token,
    )

    assert response.status_code == 200, response.text
    event = (await _cell_events(db_session, project_id))[-1]
    assert event.old_value is None
    assert event.new_value == "AUTO"
    assert event.payload["old_label"] is None
    assert event.payload["new_label"] == "Automatic"


async def test_patch_cells_rejects_inactive_choice_option(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """옵션이 존재해도 비활성(is_active=False)이면 선택 불가로 거부된다."""
    project_id, cond1, _ = await _seed_project(db_session)
    await _seed_parameters(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "pr_type", "value": "LEGACY"}],
        token=token,
    )

    assert resp.status_code == 422, resp.text
    reasons = [c["reason"] for c in resp.json()["details"]["invalid_cells"]]
    assert reasons == ["invalid_choice"]
    assert (await _cell_value(db_session, cond1, "pr_type"))[0] is False


async def test_patch_cells_rejects_new_choice_when_set_is_inactive(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, cond1, _ = await _seed_project(db_session)
    await _seed_parameters(db_session)
    choice_set = (
        await db_session.execute(
            select(ChoiceSet).where(ChoiceSet.code == "equipment_mode")
        )
    ).scalar_one()
    choice_set.is_active = False
    await db_session.commit()
    token = await _acquire(db_client, project_id)

    response = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "pr_type", "value": "A"}],
        token=token,
    )

    assert response.status_code == 422, response.text
    assert response.json()["details"]["invalid_cells"][0]["reason"] == "invalid_choice"
    assert (await _cell_value(db_session, cond1, "pr_type"))[0] is False


async def test_known_inactive_stored_value_may_be_resubmitted_as_noop(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, cond1, _ = await _seed_project(db_session)
    await _seed_parameters(db_session)
    db_session.add(
        CellValue(condition_id=cond1, parameter_code="pr_type", value_text="LEGACY")
    )
    await db_session.commit()
    token = await _acquire(db_client, project_id)

    response = await _patch(
        db_client,
        project_id,
        [{"condition_id": cond1, "parameter_code": "pr_type", "value": " LEGACY "}],
        token=token,
    )

    assert response.status_code == 200, response.text
    assert response.json()["cells"][0]["value"] == "LEGACY"
    assert (await _cell_value(db_session, cond1, "pr_type"))[1] == "LEGACY"
    assert await _cell_events(db_session, project_id) == []


async def test_changed_away_then_back_to_inactive_in_one_batch_is_rejected_atomically(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, cond1, _ = await _seed_project(db_session)
    await _seed_parameters(db_session)
    db_session.add(
        CellValue(condition_id=cond1, parameter_code="pr_type", value_text="LEGACY")
    )
    await db_session.commit()
    token = await _acquire(db_client, project_id)

    response = await _patch(
        db_client,
        project_id,
        [
            {"condition_id": cond1, "parameter_code": "pr_type", "value": "A"},
            {"condition_id": cond1, "parameter_code": "pr_type", "value": "LEGACY"},
        ],
        token=token,
    )

    assert response.status_code == 422, response.text
    assert response.json()["details"]["invalid_cells"][-1]["reason"] == "invalid_choice"
    assert (await _cell_value(db_session, cond1, "pr_type"))[1] == "LEGACY"
    assert await _cell_events(db_session, project_id) == []


async def test_patch_cells_skips_validation_for_unknown_parameter_code(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """레지스트리에 없는 code는 타입 검증 대상이 아니다 (스냅샷 독립성 설계 철학).

    parameter_code는 FK가 아니라, 알 수 없는/폐기된 code도 원시 값 그대로 통과한다.
    """
    project_id, cond1, _ = await _seed_project(db_session)
    await _seed_parameters(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        # 숫자로도 옵션으로도 볼 수 없는 값이지만, 미등록 code라 검증하지 않는다.
        [{"condition_id": cond1, "parameter_code": "ghost_code", "value": "anything"}],
        token=token,
    )

    assert resp.status_code == 200, resp.text
    assert (await _cell_value(db_session, cond1, "ghost_code"))[1] == "anything"


async def test_patch_cells_one_type_violation_rejects_whole_batch(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """위반 1건이 섞이면 나머지 유효한 셀도 전부 저장되지 않는다 (all-or-nothing)."""
    project_id, cond1, cond2 = await _seed_project(db_session)
    await _seed_parameters(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        [
            {"condition_id": cond1, "parameter_code": "temp_c", "value": "1500"},  # 유효
            {"condition_id": cond1, "parameter_code": "pr_type", "value": "A"},  # 유효
            {"condition_id": cond2, "parameter_code": "temp_c", "value": "oops"},  # 위반
        ],
        token=token,
    )

    assert resp.status_code == 422, resp.text
    # 위반은 딱 그 셀 1건.
    assert resp.json()["details"]["invalid_cells"] == [
        {
            "condition_id": cond2,
            "parameter_code": "temp_c",
            "value": "oops",
            "reason": "invalid_number",
        }
    ]
    # 유효했던 두 셀도 저장되지 않고 이벤트도 없다.
    assert (await _cell_value(db_session, cond1, "temp_c"))[0] is False
    assert (await _cell_value(db_session, cond1, "pr_type"))[0] is False
    assert (await _cell_value(db_session, cond2, "temp_c"))[0] is False
    assert await _cell_events(db_session, project_id) == []


async def test_patch_cells_clearing_skips_type_check(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """셀 비우기(null/공백)는 number/choice 파라미터여도 타입 검사 없이 통과한다."""
    project_id, cond1, cond2 = await _seed_project(db_session)
    await _seed_parameters(db_session)
    token = await _acquire(db_client, project_id)

    resp = await _patch(
        db_client,
        project_id,
        [
            {"condition_id": cond1, "parameter_code": "temp_c", "value": None},
            {"condition_id": cond1, "parameter_code": "pr_type", "value": "   "},
            {"condition_id": cond2, "parameter_code": "temp_c", "value": ""},
        ],
        token=token,
    )

    assert resp.status_code == 200, resp.text
    values = {
        (c["condition_id"], c["parameter_code"]): c["value"] for c in resp.json()["cells"]
    }
    assert values == {
        (cond1, "temp_c"): None,
        (cond1, "pr_type"): None,
        (cond2, "temp_c"): None,
    }
    # 신규 빈 값은 반영할 게 없어 행/이벤트를 만들지 않는다.
    assert await _cell_events(db_session, project_id) == []
