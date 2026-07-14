"""공정/layer 조회 API 테스트."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingest.fixture_reader import FixtureIngestReader, get_ingest_reader
from app.ingest.reader import ProcessInfo
from app.main import app
from tests.factories import seed_required_profile_choice_sets


@pytest.fixture(autouse=True)
async def _required_profile_choices(db_session: AsyncSession) -> None:
    await seed_required_profile_choice_sets(db_session)
    await db_session.commit()


class _CatalogDisplayReader(FixtureIngestReader):
    async def get_process(self, line_id: str, process_id: str) -> ProcessInfo:
        assert (line_id, process_id) == ("L1", "PROC_ALPHA")
        return ProcessInfo(
            key="L1::PROC_ALPHA",
            line_id=line_id,
            process_id=process_id,
            display_name="Catalog-owned display snapshot",
        )


def _get_catalog_display_reader() -> FixtureIngestReader:
    return _CatalogDisplayReader()


async def test_list_processes(db_client: AsyncClient) -> None:
    resp = await db_client.get("/api/processes")

    assert resp.status_code == 200
    body = resp.json()
    assert [process["key"] for process in body["items"]] == [
        "L1::PROC_ALPHA",
        "L1::PROC_BETA",
    ]
    assert body["items"][0]["has_project"] is False
    assert body["next_cursor"] is None


async def test_list_processes_search_and_without_project_filter(
    db_client: AsyncClient,
) -> None:
    # ALPHA에 프로젝트를 만들면 "조건표 없는 것만" 필터에서 빠진다.
    await db_client.post(
        "/api/projects",
        json={
            "line_id": "L1",
            "process_id": "PROC_ALPHA",
            "part_id": "P",
            "name": "N",
            "device_type_code": "DEFAULT",
            "project_category_code": "DEFAULT",
        },
    )

    searched = await db_client.get("/api/processes", params={"query": "BETA"})
    assert [p["key"] for p in searched.json()["items"]] == ["L1::PROC_BETA"]

    without = await db_client.get("/api/processes", params={"without_project": True})
    keys = [p["key"] for p in without.json()["items"]]
    assert "L1::PROC_ALPHA" not in keys
    assert "L1::PROC_BETA" in keys


async def test_process_detail_reports_structure_and_condition_table(
    db_client: AsyncClient,
) -> None:
    app.dependency_overrides[get_ingest_reader] = _get_catalog_display_reader
    try:
        detail = await db_client.get("/api/processes/L1::PROC_ALPHA")
    finally:
        app.dependency_overrides.pop(get_ingest_reader, None)

    assert detail.status_code == 200
    body = detail.json()
    assert body["display_name"] == "Catalog-owned display snapshot"
    assert body["step_count"] == 3
    assert body["area_names"] == ["CLEAN", "ETCH", "PHOTO"]
    assert body["has_project"] is False

    await db_client.post(
        "/api/projects",
        json={
            "line_id": "L1",
            "process_id": "PROC_ALPHA",
            "part_id": "P",
            "name": "N",
            "device_type_code": "DEFAULT",
            "project_category_code": "DEFAULT",
        },
    )
    after = await db_client.get("/api/processes/L1::PROC_ALPHA")
    assert after.json()["has_project"] is True
    assert after.json()["project_count"] == 1


async def test_get_process_layers(db_client: AsyncClient) -> None:
    resp = await db_client.get("/api/processes/L1::PROC_ALPHA/layers")

    assert resp.status_code == 200
    assert [(layer["step_seq"], layer["layer_id"]) for layer in resp.json()] == [
        ("001", "CLN"),
        ("010", "ACT"),
        ("020", "ACT"),
    ]


async def test_get_missing_process_layers_404(db_client: AsyncClient) -> None:
    resp = await db_client.get("/api/processes/missing/layers")

    assert resp.status_code == 404
    assert resp.json()["code"] == "not_found"
