"""공정/layer 조회 API 테스트."""

from httpx import AsyncClient


async def test_list_processes(client: AsyncClient) -> None:
    resp = await client.get("/processes")

    assert resp.status_code == 200
    body = resp.json()
    assert [process["key"] for process in body] == ["L1::PROC_ALPHA", "L1::PROC_BETA"]
    assert body[0]["line_id"] == "L1"
    assert body[0]["process_id"] == "PROC_ALPHA"


async def test_get_process_layers(client: AsyncClient) -> None:
    resp = await client.get("/processes/L1::PROC_ALPHA/layers")

    assert resp.status_code == 200
    assert [(layer["step_seq"], layer["layer_id"]) for layer in resp.json()] == [
        ("001", "CLN"),
        ("010", "ACT"),
        ("020", "ACT"),
    ]


async def test_get_missing_process_layers_404(client: AsyncClient) -> None:
    resp = await client.get("/processes/missing/layers")

    assert resp.status_code == 404
    assert resp.json()["code"] == "not_found"
