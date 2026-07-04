"""fixture 적재 판독기 계약 테스트."""

import pytest

from app.core.errors import NotFoundError
from app.ingest.fixture_reader import FixtureIngestReader


async def test_list_processes_returns_fixture_processes() -> None:
    reader = FixtureIngestReader()

    processes = await reader.list_processes()

    assert [process.key for process in processes] == ["lithography", "etch"]


async def test_get_layers_returns_different_dynamic_shapes() -> None:
    reader = FixtureIngestReader()

    lithography_layers = await reader.get_layers("lithography")
    etch_layers = await reader.get_layers("etch")

    assert [layer.key for layer in lithography_layers] == [
        "bottom",
        "photoresist",
        "topcoat",
    ]
    assert [layer.key for layer in etch_layers] == ["mask", "target"]
    assert len(lithography_layers) != len(etch_layers)


async def test_get_condition_values_returns_backbone_source_values() -> None:
    reader = FixtureIngestReader()

    values = await reader.get_condition_values("etch")

    assert [(v.layer_key, v.source_param_id, v.value) for v in values] == [
        ("mask", "selectivity", 3.2),
        ("target", "etch_rate_nm_min", 18.7),
    ]


async def test_missing_process_raises_not_found() -> None:
    reader = FixtureIngestReader()

    with pytest.raises(NotFoundError):
        await reader.get_layers("missing")
