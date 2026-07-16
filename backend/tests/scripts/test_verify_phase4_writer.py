"""Rollback-only Phase 4 writer smoke scaffold contract."""

import pytest

from app.core import maintenance
from scripts.verify_phase4_writer import build_smoke_report, main


async def test_rollback_smoke_report_marks_pass_when_gate_is_disabled(monkeypatch) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    report = await build_smoke_report(rollback=True)

    assert report["status"] == "PASS"
    assert report["mode"] == "rollback"
    assert report["health"]["pre_unfreeze_ready"] is True
    assert report["health"]["runtime_state"] == "pre_unfreeze"
    assert report["checks"]["rollback_only"] is True


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
