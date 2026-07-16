"""조건 행 관리 + POR 선택 API 테스트 (P2-T7 / D-16).

- 빈 조건 행 추가: 라벨 자동 부여("C{n}") + condition_index 최댓값+1 + 비-POR +
  change_event(condition_add)
- 라벨 빈 자리 채우기: 중간 라벨이 비면 그 자리를 다시 쓴다(단, index는 최댓값+1)
- 복제: 원본 셀 값 복사 + is_por=False 강제(원본이 POR이어도) + source_condition_id 기록
- 다른 layer 조건을 source로 복제 시도 → 거부(422)
- 하드 삭제: 조회 시 없음 + change_event(condition_remove) payload에 스냅샷
  (label/is_por/condition_index/cells)
- layer의 마지막 조건 행 삭제 → 거부(422)
- POR 이양: 기존 POR 해제 + 신규 지정 + 동시에 둘 다 POR인 상태 없음 +
  change_event(por_change) old/new
- POR 없던 layer 최초 지정 → old_por_condition_id=None
- 이미 POR인 행에 재지정 → no-op(이벤트 없음)
- 잠금 없이 호출 시 409, 보유 시 통과 (3개 엔드포인트)
- 존재하지 않는 project/layer/condition → 404

인증 스텁이 항상 dev-admin을 반환하므로 세션 구분은 lock_token으로만 이뤄진다.
db_client(API)와 db_session(직접 시드/검증)은 같은 인메모리 엔진을 공유한다.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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
from tests.factories import make_project_profile


@dataclass
class _Cond:
    """시드용 조건 행 명세 (label, POR 여부, 셀 값)."""

    label: str
    is_por: bool = False
    cells: dict[str, str | None] | None = None


def _build_conditions(specs: list[_Cond]) -> list[LayerCondition]:
    """명세 목록을 LayerCondition 목록으로 만든다 (condition_index는 1부터 순번)."""
    conditions: list[LayerCondition] = []
    for index, spec in enumerate(specs, start=1):
        cond = LayerCondition(label=spec.label, condition_index=index, is_por=spec.is_por)
        for code, value in (spec.cells or {}).items():
            cond.cell_values.append(CellValue(parameter_code=code, value_text=value))
        conditions.append(cond)
    return conditions


async def _seed_project(
    session: AsyncSession,
    conditions: list[_Cond],
    *,
    process_id: str = "PROC_X",
    part_id: str = "P1",
    layer_key: str = "L1::PROC_X::010::ACT",
) -> tuple[int, str, list[int]]:
    """1 layer 프로젝트를 심는다. 반환: (project_id, layer_key, 조건 행 id 목록)."""
    project = Project(
        line_id="L1",
        process_id=process_id,
        part_id=part_id,
        name="cond test",
        status=ProjectStatus.DRAFT,
        profile=make_project_profile(process_name=process_id),
    )
    layer = SheetLayer(layer_key=layer_key, step_seq="010", layer_id="ACT", sort_order=1)
    layer.conditions.extend(_build_conditions(conditions))
    project.layers.append(layer)
    session.add(project)
    await session.flush()
    result = (project.id, layer.layer_key, [c.id for c in layer.conditions])
    await session.commit()
    return result


async def _add_layer(
    session: AsyncSession,
    project_id: int,
    conditions: list[_Cond],
    *,
    layer_key: str,
    layer_id: str = "DEP",
    step_seq: str = "020",
    sort_order: int = 2,
) -> tuple[str, list[int]]:
    """기존 프로젝트에 두 번째 layer를 붙인다 (타 layer 소속 검증용)."""
    layer = SheetLayer(
        project_id=project_id,
        layer_key=layer_key,
        step_seq=step_seq,
        layer_id=layer_id,
        sort_order=sort_order,
    )
    layer.conditions.extend(_build_conditions(conditions))
    session.add(layer)
    await session.flush()
    result = (layer.layer_key, [c.id for c in layer.conditions])
    await session.commit()
    return result


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


async def _acquire(client: AsyncClient, project_id: int) -> str:
    resp = await client.post(f"/api/projects/{project_id}/lock")
    assert resp.status_code == 200, resp.text
    return resp.json()["lock_token"]


def _headers(token: str | None) -> dict[str, str]:
    return {"X-Lock-Token": token} if token is not None else {}


async def _add(
    client: AsyncClient,
    project_id: int,
    layer_key: str,
    *,
    source_condition_id: int | None = None,
    token: str | None = None,
) -> Response:
    return await client.post(
        f"/api/projects/{project_id}/layers/{layer_key}/conditions",
        json={"source_condition_id": source_condition_id},
        headers=_headers(token),
    )


async def _delete(
    client: AsyncClient, project_id: int, condition_id: int, *, token: str | None = None
) -> Response:
    return await client.delete(
        f"/api/projects/{project_id}/conditions/{condition_id}",
        headers=_headers(token),
    )


async def _set_por(
    client: AsyncClient, project_id: int, condition_id: int, *, token: str | None = None
) -> Response:
    return await client.put(
        f"/api/projects/{project_id}/conditions/{condition_id}/por",
        headers=_headers(token),
    )


async def _events(
    session: AsyncSession, project_id: int, event_type: ChangeEventType
) -> list[ChangeEvent]:
    """프로젝트의 특정 유형 이벤트를 id 순으로 조회한다 (커밋된 최신 상태)."""
    session.expire_all()
    rows = await session.execute(
        select(ChangeEvent)
        .where(
            ChangeEvent.project_id == project_id,
            ChangeEvent.event_type == event_type,
        )
        .order_by(ChangeEvent.id)
    )
    return list(rows.scalars().all())


async def _get_condition(session: AsyncSession, condition_id: int) -> LayerCondition | None:
    """조건 행 하나를 셀까지 로드해 조회한다 (없으면 None)."""
    session.expire_all()
    return (
        await session.execute(
            select(LayerCondition)
            .where(LayerCondition.id == condition_id)
            .options(selectinload(LayerCondition.cell_values))
        )
    ).scalar_one_or_none()


async def _layer_conditions(session: AsyncSession, layer_key: str) -> list[LayerCondition]:
    """layer의 조건 행을 condition_index 순으로 조회한다."""
    session.expire_all()
    rows = await session.execute(
        select(LayerCondition)
        .join(SheetLayer, LayerCondition.layer_id == SheetLayer.id)
        .where(SheetLayer.layer_key == layer_key)
        .order_by(LayerCondition.condition_index)
    )
    return list(rows.scalars().all())


# --- 조건 행 추가 -----------------------------------------------------------


async def test_add_empty_condition_assigns_next_label_and_index(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, layer_key, _ = await _seed_project(
        db_session, [_Cond("C1"), _Cond("C2")]
    )
    token = await _acquire(db_client, project_id)

    resp = await _add(db_client, project_id, layer_key, token=token)

    assert resp.status_code == 201, resp.text
    body = resp.json()
    # C1, C2가 있으므로 다음 라벨은 C3, index는 최댓값(2)+1=3, POR은 항상 False.
    assert body["label"] == "C3"
    assert body["condition_index"] == 3
    assert body["is_por"] is False
    assert body["layer_key"] == layer_key
    new_id = body["id"]

    created = await _get_condition(db_session, new_id)
    assert created is not None
    assert created.label == "C3"
    assert created.condition_index == 3
    assert created.is_por is False
    assert created.cell_values == []  # 빈 추가라 셀 없음.

    # condition_add 이벤트: payload에 layer_key/condition_id/source(None).
    events = await _events(db_session, project_id, ChangeEventType.CONDITION_ADD)
    assert len(events) == 1
    assert events[0].condition_id == new_id
    assert events[0].layer_key == layer_key
    assert events[0].origin == "manual"
    assert events[0].source_project_id is None
    assert events[0].source_layer_key is None
    assert events[0].payload == {
        "layer_key": layer_key,
        "condition_id": new_id,
        "source_condition_id": None,
        "snapshot": {
            "label": "C3",
            "is_por": False,
            "condition_index": 3,
            "cells": {},
        },
    }
    assert events[0].actor == "dev-admin"


async def test_add_fills_label_gap_but_index_is_monotonic(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """중간 라벨(C2)이 비면 라벨은 그 자리를 채우고, index는 최댓값+1로 커진다."""
    # 라벨은 C1/C3지만 condition_index는 1/2로 심긴다(라벨과 순번은 독립).
    project_id, layer_key, _ = await _seed_project(
        db_session, [_Cond("C1"), _Cond("C3")]
    )
    token = await _acquire(db_client, project_id)

    resp = await _add(db_client, project_id, layer_key, token=token)

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["label"] == "C2"  # 빈 라벨 자리를 채운다.
    assert body["condition_index"] == 3  # index는 빈 자리를 채우지 않는다(최댓값 2 + 1).


async def test_condition_events_populate_structured_envelope_columns(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """조건 추가/삭제/POR은 layer_key/origin/condition_id 구조화 컬럼을 채운다."""
    project_id, layer_key, cond_ids = await _seed_project(
        db_session,
        [
            _Cond("C1", is_por=True, cells={"spin_speed": "1200"}),
            _Cond("C2"),
            _Cond("C3"),
        ],
    )
    source_id, remove_id, por_id = cond_ids
    token = await _acquire(db_client, project_id)

    add_resp = await _add(
        db_client,
        project_id,
        layer_key,
        source_condition_id=source_id,
        token=token,
    )
    assert add_resp.status_code == 201, add_resp.text
    add_event = (await _events(db_session, project_id, ChangeEventType.CONDITION_ADD))[-1]
    assert add_event.condition_id == add_resp.json()["id"]
    assert add_event.layer_key == layer_key
    assert add_event.origin == "manual"
    assert add_event.source_project_id is None
    assert add_event.source_layer_key is None

    delete_resp = await _delete(db_client, project_id, remove_id, token=token)
    assert delete_resp.status_code == 204, delete_resp.text
    delete_event = (await _events(db_session, project_id, ChangeEventType.CONDITION_REMOVE))[-1]
    assert delete_event.condition_id == remove_id
    assert delete_event.layer_key == layer_key
    assert delete_event.origin == "manual"
    assert delete_event.source_project_id is None
    assert delete_event.source_layer_key is None

    por_resp = await _set_por(db_client, project_id, por_id, token=token)
    assert por_resp.status_code == 200, por_resp.text
    por_event = (await _events(db_session, project_id, ChangeEventType.POR_CHANGE))[-1]
    assert por_event.condition_id == por_id
    assert por_event.layer_key == layer_key
    assert por_event.origin == "manual"
    assert por_event.source_project_id is None
    assert por_event.source_layer_key is None


async def test_duplicate_copies_cells_and_forces_non_por(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, layer_key, cond_ids = await _seed_project(
        db_session,
        [
            _Cond("C1", is_por=True, cells={"spin_speed": "1200", "pr_type": "A"}),
            _Cond("C2"),
        ],
    )
    source_id = cond_ids[0]
    token = await _acquire(db_client, project_id)

    resp = await _add(
        db_client, project_id, layer_key, source_condition_id=source_id, token=token
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["label"] == "C3"
    assert body["condition_index"] == 3
    # 원본이 POR이어도 복제본은 비-POR로 강제된다 (POR 중복 방지).
    assert body["is_por"] is False
    new_id = body["id"]

    created = await _get_condition(db_session, new_id)
    assert created is not None
    # 원본 셀 값이 새 행에 그대로 복사된다.
    assert {c.parameter_code: c.value_text for c in created.cell_values} == {
        "spin_speed": "1200",
        "pr_type": "A",
    }
    assert created.is_por is False
    assert created.source_condition_id == source_id  # 복제 원본 provenance.

    # 원본 POR은 그대로 유지된다 (복제가 POR을 옮기지 않는다).
    source = await _get_condition(db_session, source_id)
    assert source is not None and source.is_por is True

    events = await _events(db_session, project_id, ChangeEventType.CONDITION_ADD)
    assert len(events) == 1
    assert events[0].payload["source_condition_id"] == source_id
    assert events[0].payload["condition_id"] == new_id
    assert events[0].payload["snapshot"]["cells"] == {
        "spin_speed": "1200",
        "pr_type": "A",
    }


async def test_duplicate_rejects_source_from_other_layer(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, layer_a_key, _ = await _seed_project(
        db_session, [_Cond("C1")], layer_key="L1::PROC_X::010::ACT"
    )
    _, layer_b_ids = await _add_layer(
        db_session,
        project_id,
        [_Cond("C1", cells={"spin_speed": "5"})],
        layer_key="L1::PROC_X::020::DEP",
    )
    token = await _acquire(db_client, project_id)

    # layer B의 조건을 layer A로 복제 시도 → 소속 위반으로 거부.
    resp = await _add(
        db_client,
        project_id,
        layer_a_key,
        source_condition_id=layer_b_ids[0],
        token=token,
    )

    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "validation_error"
    assert body["details"]["source_condition_id"] == layer_b_ids[0]

    # 전체 거부 — layer A에 새 행이 생기지 않고 이벤트도 없다.
    assert len(await _layer_conditions(db_session, layer_a_key)) == 1
    assert await _events(db_session, project_id, ChangeEventType.CONDITION_ADD) == []


# --- 조건 행 삭제 -----------------------------------------------------------


async def test_delete_hard_removes_and_snapshots(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, layer_key, cond_ids = await _seed_project(
        db_session,
        [
            _Cond("C1", is_por=True, cells={"spin_speed": "1200"}),
            _Cond("C2"),
        ],
    )
    target_id, keep_id = cond_ids
    token = await _acquire(db_client, project_id)

    resp = await _delete(db_client, project_id, target_id, token=token)

    assert resp.status_code == 204, resp.text

    # 하드 삭제 — 조회 시 없다 (POR 행이어도 삭제 허용). 셀도 cascade로 사라진다.
    assert await _get_condition(db_session, target_id) is None
    # 나머지 행은 유지된다.
    assert await _get_condition(db_session, keep_id) is not None

    # condition_remove 이벤트 payload 스냅샷에 label/is_por/index/cells가 남는다.
    events = await _events(db_session, project_id, ChangeEventType.CONDITION_REMOVE)
    assert len(events) == 1
    payload = events[0].payload
    assert payload["layer_key"] == layer_key
    assert payload["condition_id"] == target_id
    assert payload["snapshot"] == {
        "label": "C1",
        "is_por": True,
        "condition_index": 1,
        "cells": {"spin_speed": "1200"},
    }


async def test_delete_last_condition_rejected(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _, cond_ids = await _seed_project(db_session, [_Cond("C1")])
    only_id = cond_ids[0]
    token = await _acquire(db_client, project_id)

    resp = await _delete(db_client, project_id, only_id, token=token)

    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "validation_error"

    # 거부됨 — 행은 그대로 남고 삭제 이벤트도 없다.
    assert await _get_condition(db_session, only_id) is not None
    assert await _events(db_session, project_id, ChangeEventType.CONDITION_REMOVE) == []


# --- POR 이양 ---------------------------------------------------------------


async def test_set_por_transfers_and_keeps_single_por(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, layer_key, cond_ids = await _seed_project(
        db_session, [_Cond("C1", is_por=True), _Cond("C2")]
    )
    old_por, new_por = cond_ids
    token = await _acquire(db_client, project_id)

    resp = await _set_por(db_client, project_id, new_por, token=token)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == new_por
    assert body["is_por"] is True

    # DB: 정확히 한 행만 POR이고 그게 새 대상이다 (기존 POR은 해제됨).
    conditions = await _layer_conditions(db_session, layer_key)
    assert [c.id for c in conditions if c.is_por] == [new_por]

    # por_change 이벤트: old/new 기록.
    events = await _events(db_session, project_id, ChangeEventType.POR_CHANGE)
    assert len(events) == 1
    assert events[0].payload == {
        "layer_key": layer_key,
        "old_por_condition_id": old_por,
        "new_por_condition_id": new_por,
    }


async def test_set_por_first_assignment_has_null_old(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """POR이 없던 layer에 최초 지정 → old_por_condition_id는 None."""
    project_id, layer_key, cond_ids = await _seed_project(
        db_session, [_Cond("C1"), _Cond("C2")]
    )
    target = cond_ids[0]
    token = await _acquire(db_client, project_id)

    resp = await _set_por(db_client, project_id, target, token=token)

    assert resp.status_code == 200, resp.text
    assert resp.json()["is_por"] is True

    conditions = await _layer_conditions(db_session, layer_key)
    assert [c.id for c in conditions if c.is_por] == [target]

    events = await _events(db_session, project_id, ChangeEventType.POR_CHANGE)
    assert len(events) == 1
    assert events[0].payload["old_por_condition_id"] is None
    assert events[0].payload["new_por_condition_id"] == target


async def test_set_por_on_current_por_is_noop(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """이미 POR인 행에 재지정해도 안전(no-op) — 상태 유지 + 이벤트 없음."""
    project_id, layer_key, cond_ids = await _seed_project(
        db_session, [_Cond("C1", is_por=True), _Cond("C2")]
    )
    current_por = cond_ids[0]
    token = await _acquire(db_client, project_id)

    resp = await _set_por(db_client, project_id, current_por, token=token)

    assert resp.status_code == 200, resp.text
    assert resp.json()["is_por"] is True

    conditions = await _layer_conditions(db_session, layer_key)
    assert [c.id for c in conditions if c.is_por] == [current_por]

    # 실제 변경이 없으니 por_change 이벤트를 남기지 않는다.
    assert await _events(db_session, project_id, ChangeEventType.POR_CHANGE) == []


# --- 잠금 검사 (3개 엔드포인트) ---------------------------------------------


async def test_add_requires_lock(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, layer_key, _ = await _seed_project(db_session, [_Cond("C1")])

    no_lock = await _add(db_client, project_id, layer_key)
    assert no_lock.status_code == 409
    assert no_lock.json()["code"] == "lock_conflict"

    token = await _acquire(db_client, project_id)
    ok = await _add(db_client, project_id, layer_key, token=token)
    assert ok.status_code == 201, ok.text


async def test_delete_requires_lock(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _, cond_ids = await _seed_project(
        db_session, [_Cond("C1"), _Cond("C2")]
    )
    target = cond_ids[0]

    no_lock = await _delete(db_client, project_id, target)
    assert no_lock.status_code == 409
    assert no_lock.json()["code"] == "lock_conflict"

    token = await _acquire(db_client, project_id)
    ok = await _delete(db_client, project_id, target, token=token)
    assert ok.status_code == 204, ok.text


async def test_set_por_requires_lock(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _, cond_ids = await _seed_project(
        db_session, [_Cond("C1"), _Cond("C2")]
    )
    target = cond_ids[1]

    no_lock = await _set_por(db_client, project_id, target)
    assert no_lock.status_code == 409
    assert no_lock.json()["code"] == "lock_conflict"

    token = await _acquire(db_client, project_id)
    ok = await _set_por(db_client, project_id, target, token=token)
    assert ok.status_code == 200, ok.text


# --- 미존재 project / layer / condition → 404 -------------------------------


async def test_add_unknown_layer_returns_404(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _, _ = await _seed_project(db_session, [_Cond("C1")])
    token = await _acquire(db_client, project_id)

    resp = await _add(db_client, project_id, "L1::PROC_X::999::GONE", token=token)

    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "not_found"


async def test_add_unknown_project_returns_404(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    # 미존재 프로젝트에 유효 잠금을 직접 심어 require_edit_lock을 통과시킨 뒤,
    # 서비스의 layer 조회 404 경로를 격리 검증한다 (SQLite는 FK 미강제).
    missing_id = 999999
    await _seed_lock(db_session, missing_id, token="ghost-token")

    resp = await _add(
        db_client, missing_id, "L1::PROC_X::010::ACT", token="ghost-token"
    )

    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "not_found"


async def test_delete_unknown_condition_returns_404(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _, _ = await _seed_project(db_session, [_Cond("C1")])
    token = await _acquire(db_client, project_id)

    resp = await _delete(db_client, project_id, 999999, token=token)

    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "not_found"


async def test_set_por_unknown_condition_returns_404(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _, _ = await _seed_project(db_session, [_Cond("C1")])
    token = await _acquire(db_client, project_id)

    resp = await _set_por(db_client, project_id, 999999, token=token)

    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "not_found"
