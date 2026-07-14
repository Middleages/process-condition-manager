from dataclasses import asdict

from app.project_metadata.manual import ManualProjectMetadataProvider


async def test_manual_provider_has_auditable_identifier_and_empty_seed() -> None:
    provider = ManualProjectMetadataProvider()
    seed = await provider.load_seed(
        line_id="L1", process_id="PROC_ALPHA", part_id="PART-1"
    )

    assert provider.identifier == "manual"
    assert all(value is None for value in asdict(seed).values())
    assert "line_id" not in asdict(seed)
    assert "process_id" not in asdict(seed)
    assert "part_id" not in asdict(seed)
    assert "process_name" not in asdict(seed)
