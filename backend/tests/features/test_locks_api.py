"""편집 잠금 API 테스트 (T5).

- 획득 → 하트비트 → 해제 정상 흐름
- 유효 잠금 보유 중 재획득/타 토큰 하트비트 충돌(409)
- 만료 잠금 탈취 (옛 토큰 무효화)
- 해제 idempotency (없어도 204, 타 토큰은 무해한 no-op)
- backbone-replace 소급 잠금 검사 (미보유 409 / 보유 통과 / 타 토큰 409)
- 두 세션(서로 다른 lock_token) 시뮬레이션 (EC3)

인증 스텁이 항상 dev-admin을 반환하므로, 세션 구분은 lock_token으로만 이뤄진다.
"""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient, Response
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import EditLock


async def _create_project(
    client: AsyncClient,
    *,
    process_id: str = "PROC_ALPHA",
    part_id: str = "P",
    name: str = "N",
) -> dict:
    resp = await client.post(
        "/api/projects",
        json={
            "line_id": "L1",
            "process_id": process_id,
            "part_id": part_id,
            "name": name,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _acquire(client: AsyncClient, project_id: int) -> str:
    resp = await client.post(f"/api/projects/{project_id}/lock")
    assert resp.status_code == 200, resp.text
    return resp.json()["lock_token"]


async def _heartbeat(client: AsyncClient, project_id: int, token: str) -> Response:
    return await client.post(
        f"/api/projects/{project_id}/lock/heartbeat", json={"lock_token": token}
    )


async def _release(client: AsyncClient, project_id: int, token: str) -> Response:
    # httpx의 delete()는 body를 받지 않으므로 request()로 JSON 바디를 싣는다.
    return await client.request(
        "DELETE", f"/api/projects/{project_id}/lock", json={"lock_token": token}
    )


async def _expire_lock(session: AsyncSession, project_id: int) -> None:
    """잠금을 강제로 만료시킨다 (탈취/만료 흐름 검증용)."""
    await session.execute(
        update(EditLock)
        .where(EditLock.project_id == project_id)
        .values(expires_at=datetime.now(UTC) - timedelta(hours=1))
    )
    await session.commit()


async def _source_and_target(client: AsyncClient) -> tuple[dict, dict]:
    source = await _create_project(client, process_id="PROC_ALPHA", part_id="SRC", name="Source")
    target = await _create_project(client, process_id="PROC_BETA", part_id="TGT", name="Target")
    return source, target


# --- 잠금 라이프사이클 -------------------------------------------------------


async def test_acquire_returns_token(db_client: AsyncClient) -> None:
    project = await _create_project(db_client)

    resp = await db_client.post(f"/api/projects/{project['id']}/lock")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["locked_by"] == "dev-admin"
    assert body["lock_token"]
    assert body["expires_at"] is not None


async def test_acquire_unknown_project_returns_404(db_client: AsyncClient) -> None:
    resp = await db_client.post("/api/projects/999999/lock")

    assert resp.status_code == 404
    assert resp.json()["code"] == "not_found"


async def test_acquire_conflicts_when_valid_lock_held(db_client: AsyncClient) -> None:
    project = await _create_project(db_client)
    await _acquire(db_client, project["id"])

    # 유효 잠금이 있으면 (같은 사용자여도) 재획득은 409.
    resp = await db_client.post(f"/api/projects/{project['id']}/lock")

    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == "lock_conflict"
    assert body["details"]["locked_by"] == "dev-admin"


async def test_heartbeat_extends_lock(db_client: AsyncClient) -> None:
    project = await _create_project(db_client)
    acquired = (await db_client.post(f"/api/projects/{project['id']}/lock")).json()
    token = acquired["lock_token"]

    resp = await _heartbeat(db_client, project["id"], token)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["lock_token"] == token
    # 만료 시각이 최초 획득 이후로 유지/연장된다 (뒤로 가지 않는다).
    assert body["expires_at"] >= acquired["expires_at"]


async def test_heartbeat_wrong_token_conflicts(db_client: AsyncClient) -> None:
    project = await _create_project(db_client)
    await _acquire(db_client, project["id"])

    resp = await _heartbeat(db_client, project["id"], "wrong-token")

    assert resp.status_code == 409
    assert resp.json()["code"] == "lock_conflict"


async def test_heartbeat_without_lock_conflicts(db_client: AsyncClient) -> None:
    project = await _create_project(db_client)

    resp = await _heartbeat(db_client, project["id"], "whatever")

    assert resp.status_code == 409


async def test_heartbeat_on_expired_lock_conflicts(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    """만료된 잠금은 보유자의 옳은 토큰 하트비트로도 되살릴 수 없다 — 재획득해야 한다."""
    project = await _create_project(db_client)
    token = await _acquire(db_client, project["id"])
    await _expire_lock(db_session, project["id"])

    resp = await _heartbeat(db_client, project["id"], token)

    assert resp.status_code == 409


async def test_release_is_idempotent(db_client: AsyncClient) -> None:
    project = await _create_project(db_client)
    token = await _acquire(db_client, project["id"])

    first = await _release(db_client, project["id"], token)
    second = await _release(db_client, project["id"], token)

    assert first.status_code == 204
    assert second.status_code == 204  # 이미 없어도 204
    # 해제 후 같은 토큰 하트비트는 잠금이 없어 409.
    assert (await _heartbeat(db_client, project["id"], token)).status_code == 409


async def test_release_wrong_token_keeps_lock(db_client: AsyncClient) -> None:
    project = await _create_project(db_client)
    token = await _acquire(db_client, project["id"])

    released = await _release(db_client, project["id"], "wrong-token")

    assert released.status_code == 204  # idempotent no-op — 남의 잠금을 지우지 않는다
    # 원 보유자 토큰은 여전히 유효하다.
    assert (await _heartbeat(db_client, project["id"], token)).status_code == 200


async def test_beacon_release_endpoint_releases_lock(db_client: AsyncClient) -> None:
    """beforeunload sendBeacon이 쓸 POST 경로도 동일한 토큰 규칙으로 잠금을 해제한다."""
    project = await _create_project(db_client)
    token = await _acquire(db_client, project["id"])

    released = await db_client.post(
        f"/api/projects/{project['id']}/lock/release",
        json={"lock_token": token},
    )

    assert released.status_code == 204
    assert (await _heartbeat(db_client, project["id"], token)).status_code == 409


async def test_expired_lock_can_be_stolen(
    db_client: AsyncClient, db_session: AsyncSession
) -> None:
    project = await _create_project(db_client)
    first_token = await _acquire(db_client, project["id"])
    await _expire_lock(db_session, project["id"])

    resp = await db_client.post(f"/api/projects/{project['id']}/lock")

    assert resp.status_code == 200, resp.text
    second_token = resp.json()["lock_token"]
    assert second_token != first_token
    # 탈취 후 옛 토큰 하트비트는 409 (뒤늦은 저장 사고 차단).
    assert (await _heartbeat(db_client, project["id"], first_token)).status_code == 409


# --- backbone-replace 소급 잠금 검사 -----------------------------------------


async def test_backbone_replace_requires_lock(db_client: AsyncClient) -> None:
    source, target = await _source_and_target(db_client)
    layer_key = target["layers"][1]["layer_key"]
    body = {
        "source_project_id": source["id"],
        "source_layer_key": source["layers"][0]["layer_key"],
    }
    url = f"/api/projects/{target['id']}/layers/{layer_key}/backbone-replace"

    # 잠금 없이 호출 → 409
    no_lock = await db_client.post(url, json=body)
    assert no_lock.status_code == 409
    assert no_lock.json()["code"] == "lock_conflict"

    # 잠금 보유(토큰 헤더) → 통과
    token = await _acquire(db_client, target["id"])
    ok = await db_client.post(url, json=body, headers={"X-Lock-Token": token})
    assert ok.status_code == 200, ok.text
    assert ok.json()["layers"][1]["source_project_id"] == source["id"]


async def test_backbone_replace_wrong_token_conflicts(db_client: AsyncClient) -> None:
    source, target = await _source_and_target(db_client)
    await _acquire(db_client, target["id"])  # 유효 잠금은 있지만 다른 토큰으로 시도
    layer_key = target["layers"][1]["layer_key"]

    resp = await db_client.post(
        f"/api/projects/{target['id']}/layers/{layer_key}/backbone-replace",
        json={
            "source_project_id": source["id"],
            "source_layer_key": source["layers"][0]["layer_key"],
        },
        headers={"X-Lock-Token": "not-the-real-token"},
    )

    assert resp.status_code == 409


async def test_two_sessions_only_one_can_edit(db_client: AsyncClient) -> None:
    """세션 A 획득 → 세션 B 재획득 409 → B가 A 토큰 없이 편집 시 409 → A는 통과."""
    source, target = await _source_and_target(db_client)
    token_a = await _acquire(db_client, target["id"])

    # 세션 B: 재획득 시도 → 409 (프로젝트당 잠금 1개).
    session_b_acquire = await db_client.post(f"/api/projects/{target['id']}/lock")
    assert session_b_acquire.status_code == 409

    layer_key = target["layers"][1]["layer_key"]
    url = f"/api/projects/{target['id']}/layers/{layer_key}/backbone-replace"
    replace_body = {
        "source_project_id": source["id"],
        "source_layer_key": source["layers"][0]["layer_key"],
    }

    # 세션 B: A의 토큰 없이 편집 → 409.
    session_b_edit = await db_client.post(
        url, json=replace_body, headers={"X-Lock-Token": "session-b-guess"}
    )
    assert session_b_edit.status_code == 409

    # 세션 A: 자기 토큰으로 편집 → 통과.
    session_a_edit = await db_client.post(
        url, json=replace_body, headers={"X-Lock-Token": token_a}
    )
    assert session_a_edit.status_code == 200, session_a_edit.text
