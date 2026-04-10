from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_legacy_projects_route_is_removed(client: AsyncClient) -> None:
    """Direct cutover policy: legacy /projects endpoint must not be exposed."""
    response = await client.get("/api/projects")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_process_conditions_route_is_active(client: AsyncClient) -> None:
    """New canonical endpoint must exist (auth failure is acceptable)."""
    response = await client.get("/api/process-conditions")
    assert response.status_code in (200, 401, 403)
    assert response.status_code != 404


@pytest.mark.asyncio
async def test_legacy_product_backbone_routes_are_removed(client: AsyncClient) -> None:
    response_list = await client.get("/api/products/backbones")
    response_layers = await client.get("/api/products/1/backbone-layers")
    assert response_list.status_code == 404
    assert response_layers.status_code == 404
