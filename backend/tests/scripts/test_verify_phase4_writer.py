"""Rollback-only Phase 4 writer smoke scaffold contract."""

from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.models  # noqa: F401 -- register all tables for create_all
from app.core.db import Base
from app.core import maintenance
from scripts.verify_phase4_writer import build_smoke_report, main


@pytest.fixture
async def sqlite_factory(tmp_path: Path) -> async_sessionmaker[AsyncSession]:
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'phase4-writer.sqlite'}",
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    finally:
        await engine.dispose()


async def test_rollback_smoke_report_marks_pass_when_gate_is_disabled(
    monkeypatch, sqlite_factory: async_sessionmaker[AsyncSession]
) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    report = await build_smoke_report(rollback=True, session_factory=sqlite_factory)

    assert report["status"] == "PASS"
    assert report["mode"] == "rollback"
    assert report["health"]["pre_unfreeze_ready"] is True
    assert report["health"]["runtime_state"] == "pre_unfreeze"
    assert report["checks"]["gate_disabled"] is True
    assert report["checks"]["backbone_copy_envelope_parity"] is True
    assert report["checks"]["backbone_replace_envelope_parity"] is True
    assert report["checks"]["row_counts_restored_after_rollback"] is True
    assert report["checks"]["project_counts_restored_after_rollback"] is True
    assert report["baseline_counts"] == report["after_rollback_counts"]
    assert report["target_event_counts"] == {
        "project_create": 1,
        "backbone_copy": 1,
        "cell_update": 2,
        "condition_add": 1,
        "condition_remove": 1,
        "por_change": 1,
        "project_profile_update": 1,
        "backbone_layer_replace": 1,
    }


async def test_rollback_smoke_report_rejects_enabled_mutations(monkeypatch) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", True)

    with pytest.raises(RuntimeError, match="rollback-only smoke requires"):
        await build_smoke_report(rollback=True)


def test_main_prints_json_and_returns_zero_when_compatible(monkeypatch, capsys) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    exit_code = main(["--rollback"])

    assert exit_code == 0
    output = capsys.readouterr().out.strip()
    assert '"status": "PASS"' in output
    assert '"mode": "rollback"' in output
