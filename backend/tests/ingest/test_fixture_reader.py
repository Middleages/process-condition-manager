"""fixture 적재 판독기 계약 테스트."""

import pytest

from app.core.errors import NotFoundError
from app.ingest.fixture_reader import FixtureIngestReader


async def test_list_processes_returns_fixture_processes() -> None:
    reader = FixtureIngestReader()

    processes = await reader.list_processes()

    assert [process.key for process in processes] == ["product_alpha_main", "product_beta_memory"]


async def test_get_layers_returns_different_dynamic_shapes() -> None:
    reader = FixtureIngestReader()

    alpha_layers = await reader.get_layers("product_alpha_main")
    beta_layers = await reader.get_layers("product_beta_memory")

    assert [layer.key for layer in alpha_layers] == [
        "001_init_clean",
        "010_photo_active",
        "020_etch_active",
        "030_metrology_active",
        "040_deposition_gate",
    ]
    assert [layer.key for layer in beta_layers] == [
        "001_init_clean",
        "015_deposition_well",
        "025_photo_well",
        "035_etch_well",
        "045_strip_well",
        "055_metrology_well",
    ]
    assert len(alpha_layers) != len(beta_layers)


async def test_get_condition_values_returns_backbone_source_values() -> None:
    reader = FixtureIngestReader()

    values = await reader.get_condition_values("product_beta_memory")

    assert [(v.layer_key, v.source_param_id, v.value) for v in values] == [
        ("001_init_clean", "clean_time_sec", 50),
        ("015_deposition_well", "thickness_nm", 120.0),
        ("025_photo_well", "exposure_dose_mj", 39.8),
        ("035_etch_well", "etch_rate_nm_min", 16.4),
        ("045_strip_well", "strip_time_sec", 75),
        ("055_metrology_well", "overlay_nm", 2.8),
    ]


async def test_missing_process_raises_not_found() -> None:
    reader = FixtureIngestReader()

    with pytest.raises(NotFoundError):
        await reader.get_layers("missing")
