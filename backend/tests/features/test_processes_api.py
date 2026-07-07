"""공정/layer 조회 API 테스트."""

from httpx import AsyncClient


async def test_list_processes(client: AsyncClient) -> None:
    resp = await client.get("/processes")

    assert resp.status_code == 200
    assert [process["key"] for process in resp.json()] == ["product_alpha_main", "product_beta_memory"]


async def test_get_process_layers(client: AsyncClient) -> None:
    resp = await client.get("/processes/product_alpha_main/layers")

    assert resp.status_code == 200
    assert [layer["key"] for layer in resp.json()] == [
        "001_init_clean",
        "010_photo_active",
        "020_etch_active",
        "030_metrology_active",
        "040_deposition_gate",
    ]


async def test_get_missing_process_layers_404(client: AsyncClient) -> None:
    resp = await client.get("/processes/missing/layers")

    assert resp.status_code == 404
    assert resp.json()["code"] == "not_found"
