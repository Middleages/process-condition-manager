"""프로젝트 생성/백본 API 테스트."""

from httpx import AsyncClient


async def test_create_project_from_process_structure(db_client: AsyncClient) -> None:
    resp = await db_client.post(
        "/projects",
        json={
            "line_id": "L1",
            "process_id": "PROC_ALPHA",
            "part_id": "PART-001",
            "name": "Alpha 조건표",
        },
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "draft"
    assert body["line_id"] == "L1"
    assert body["process_id"] == "PROC_ALPHA"
    assert body["part_id"] == "PART-001"
    assert [(layer["step_seq"], layer["layer_id"]) for layer in body["layers"]] == [
        ("001", "CLN"),
        ("010", "ACT"),
        ("020", "ACT"),
    ]
    assert [layer["condition_count"] for layer in body["layers"]] == [1, 1, 1]


async def test_duplicate_project_identity_rejected(db_client: AsyncClient) -> None:
    payload = {
        "line_id": "L1",
        "process_id": "PROC_ALPHA",
        "part_id": "PART-001",
        "name": "Alpha 조건표",
    }
    assert (await db_client.post("/projects", json=payload)).status_code == 201

    dup = await db_client.post("/projects", json=payload)

    assert dup.status_code == 409
    assert dup.json()["code"] == "conflict"


async def test_preview_without_backbone_returns_unmatched_layers(db_client: AsyncClient) -> None:
    resp = await db_client.post(
        "/projects/backbone-preview",
        json={"line_id": "L1", "process_id": "PROC_BETA"},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["matched_count"] == 0
    assert body["unmatched_count"] == 2
    assert [match["match_type"] for match in body["matches"]] == [
        "unmatched",
        "unmatched",
    ]


async def test_list_and_get_project(db_client: AsyncClient) -> None:
    created = (
        await db_client.post(
            "/projects",
            json={
                "line_id": "L1",
                "process_id": "PROC_BETA",
                "part_id": "PART-002",
                "name": "Beta 조건표",
            },
        )
    ).json()

    listed = await db_client.get("/projects")
    assert listed.status_code == 200
    assert [project["id"] for project in listed.json()] == [created["id"]]

    fetched = await db_client.get(f"/projects/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "Beta 조건표"


async def test_replace_layer_backbone_uses_source_layer_conditions(db_client: AsyncClient) -> None:
    source = (
        await db_client.post(
            "/projects",
            json={
                "line_id": "L1",
                "process_id": "PROC_ALPHA",
                "part_id": "SRC",
                "name": "Source",
            },
        )
    ).json()
    target = (
        await db_client.post(
            "/projects",
            json={
                "line_id": "L1",
                "process_id": "PROC_BETA",
                "part_id": "TGT",
                "name": "Target",
            },
        )
    ).json()

    resp = await db_client.post(
        f"/projects/{target['id']}/layers/{target['layers'][1]['layer_key']}/backbone-replace",
        json={
            "source_project_id": source["id"],
            "source_layer_key": source["layers"][0]["layer_key"],
        },
    )

    assert resp.status_code == 200, resp.text
    replaced = resp.json()["layers"][1]
    assert replaced["source_project_id"] == source["id"]
    assert replaced["source_layer_key"] == source["layers"][0]["layer_key"]
    assert replaced["condition_count"] == source["layers"][0]["condition_count"]
