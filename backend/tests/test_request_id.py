from uuid import UUID, uuid4

from httpx import AsyncClient


async def test_request_id_is_generated_and_echoed(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert str(UUID(response.headers["X-Request-ID"])) == response.headers["X-Request-ID"]


async def test_valid_request_id_is_echoed(client: AsyncClient) -> None:
    request_id = str(uuid4())
    response = await client.get("/health", headers={"X-Request-ID": request_id})
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == request_id


async def test_invalid_or_duplicate_request_id_is_rejected(client: AsyncClient) -> None:
    invalid = await client.get("/health", headers={"X-Request-ID": "not-a-uuid"})
    assert invalid.status_code == 400
    assert invalid.json()["code"] == "invalid_request_id"
    assert UUID(invalid.headers["X-Request-ID"])

    duplicate = await client.get(
        "/health",
        headers=[("X-Request-ID", str(uuid4())), ("X-Request-ID", str(uuid4()))],
    )
    assert duplicate.status_code == 400
    assert duplicate.json()["code"] == "invalid_request_id"
