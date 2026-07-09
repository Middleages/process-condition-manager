"""fixture 적재 판독기 계약 테스트."""

import pytest

from app.core.errors import NotFoundError
from app.ingest.fixture_reader import FixtureIngestReader


async def test_list_processes_returns_fixture_processes() -> None:
    reader = FixtureIngestReader()

    processes = await reader.list_processes()

    assert [process.key for process in processes] == ["L1::PROC_ALPHA", "L1::PROC_BETA"]
    assert processes[0].line_id == "L1"
    assert processes[0].process_id == "PROC_ALPHA"


async def test_get_layers_returns_different_dynamic_shapes() -> None:
    reader = FixtureIngestReader()

    alpha_layers = await reader.get_layers("L1", "PROC_ALPHA")
    beta_layers = await reader.get_layers("L1", "PROC_BETA")

    assert [(layer.step_seq, layer.layer_id) for layer in alpha_layers] == [
        ("001", "CLN"),
        ("010", "ACT"),
        ("020", "ACT"),
    ]
    assert [(layer.step_seq, layer.layer_id) for layer in beta_layers] == [
        ("001", "CLN"),
        ("015", "WELL"),
    ]
    assert len(alpha_layers) != len(beta_layers)


async def test_missing_process_raises_not_found() -> None:
    reader = FixtureIngestReader()

    with pytest.raises(NotFoundError):
        await reader.get_layers("L1", "missing")
