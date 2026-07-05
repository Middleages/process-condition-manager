"""공정/layer 조회 API 테스트."""

from httpx import AsyncClient


async def test_list_processes(client: AsyncClient) -> None:
    resp = await client.get("/processes")

    assert resp.status_code == 200
    assert [process["key"] for process in resp.json()] == ["lithography", "etch"]


async def test_get_process_layers(client: AsyncClient) -> None:
    resp = await client.get("/processes/lithography/layers")

    assert resp.status_code == 200
    assert [layer["key"] for layer in resp.json()] == [
        "bottom",
        "photoresist",
        "topcoat",
    ]


async def test_get_missing_process_layers_404(client: AsyncClient) -> None:
    resp = await client.get("/processes/missing/layers")

    assert resp.status_code == 404
    assert resp.json()["code"] == "not_found"
