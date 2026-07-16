"""Rollback-only Phase 4 writer smoke contract."""

from __future__ import annotations

import ast
import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.models  # noqa: F401 -- register all tables for create_all
import scripts.verify_phase4_writer as verify_phase4_writer
from app.core import maintenance
from app.core.db import Base
from app.domain.parameters.types import ValueType
from app.models.choice import ChoiceOption, ChoiceSet
from app.models.parameter import Parameter, ParameterCategory
from tests.postgres_database import temporary_postgres_database


@pytest.fixture
async def sqlite_factory(
    tmp_path: Path,
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
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


@pytest.fixture
async def pg_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    if os.environ.get("APP_TEST_DATABASE_URL") is None:
        pytest.skip("APP_TEST_DATABASE_URL is required for guarded PostgreSQL integration")

    with temporary_postgres_database() as database:
        engine = create_async_engine(database.async_url)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        try:
            yield async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        finally:
            await engine.dispose()


async def _truth_counts(factory: async_sessionmaker[AsyncSession]) -> dict[str, int]:
    async with factory() as session:
        value = await session.scalar(select(func.count()).select_from(ChoiceSet))
        choice_sets = int(value or 0)
        value = await session.scalar(select(func.count()).select_from(ChoiceOption))
        choice_options = int(value or 0)
        value = await session.scalar(select(func.count()).select_from(ParameterCategory))
        parameter_categories = int(value or 0)
        value = await session.scalar(select(func.count()).select_from(Parameter))
        parameters = int(value or 0)
        value = await session.scalar(select(func.count()).select_from(verify_phase4_writer.Project))
        projects = int(value or 0)
        value = await session.scalar(
            select(func.count()).select_from(verify_phase4_writer.ProjectProfile)
        )
        profiles = int(value or 0)
        value = await session.scalar(
            select(func.count()).select_from(verify_phase4_writer.SheetLayer)
        )
        layers = int(value or 0)
        value = await session.scalar(
            select(func.count()).select_from(verify_phase4_writer.LayerCondition)
        )
        conditions = int(value or 0)
        value = await session.scalar(
            select(func.count()).select_from(verify_phase4_writer.CellValue)
        )
        cells = int(value or 0)
        value = await session.scalar(
            select(func.count()).select_from(verify_phase4_writer.ChangeEvent)
        )
        events = int(value or 0)
    return {
        "choice_sets": choice_sets,
        "choice_options": choice_options,
        "parameter_categories": parameter_categories,
        "parameters": parameters,
        "projects": projects,
        "profiles": profiles,
        "layers": layers,
        "conditions": conditions,
        "cells": cells,
        "events": events,
    }


async def _seed_populated_canary(factory: async_sessionmaker[AsyncSession]) -> None:
    async with factory() as session:
        device_type = ChoiceSet(code="device_type", display_name="device_type")
        device_type.options.extend(
            [
                ChoiceOption(code="LOGIC", label="Logic", is_active=True, sort_order=10),
                ChoiceOption(code="LEGACY", label="Legacy", is_active=False, sort_order=20),
            ]
        )
        project_category = ChoiceSet(code="project_category", display_name="project_category")
        project_category.options.extend(
            [
                ChoiceOption(
                    code="DEVELOPMENT",
                    label="Development",
                    is_active=True,
                    sort_order=10,
                ),
                ChoiceOption(
                    code="ARCHIVE",
                    label="Archive",
                    is_active=False,
                    sort_order=20,
                ),
            ]
        )
        equipment_mode = ChoiceSet(code="equipment_mode", display_name="equipment_mode")
        equipment_mode.options.extend(
            [
                ChoiceOption(code="A", label="A", is_active=True, sort_order=10),
                ChoiceOption(code="B", label="B", is_active=True, sort_order=20),
            ]
        )

        equipment_category = ParameterCategory(code="equipment", display_name="EQUIPMENT")
        session.add_all(
            [
                device_type,
                project_category,
                equipment_mode,
                equipment_category,
                Parameter(
                    code="existing_speed",
                    display_name="Existing Speed",
                    value_type=ValueType.NUMBER,
                    category=equipment_category,
                    unit="rpm",
                    min_value=0,
                    max_value=5000,
                    sort_order=1,
                ),
                Parameter(
                    code="existing_mode",
                    display_name="Existing Mode",
                    value_type=ValueType.CHOICE,
                    category=equipment_category,
                    choice_set=equipment_mode,
                    sort_order=2,
                ),
            ]
        )
        await session.commit()


def _assert_no_commit_calls(path: Path) -> None:
    tree = ast.parse(path.read_text())
    commit_calls = [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "commit"
    ]
    assert not commit_calls, f"unexpected commit call(s) at lines {commit_calls}"


async def test_rollback_smoke_report_marks_pass_when_gate_is_disabled(
    monkeypatch, sqlite_factory: async_sessionmaker[AsyncSession]
) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    report = await verify_phase4_writer.build_smoke_report(
        rollback=True, session_factory=sqlite_factory
    )

    assert report["status"] == "PASS"
    assert report["mode"] == "rollback"
    assert report["health"]["pre_unfreeze_ready"] is True
    assert report["health"]["runtime_state"] == "pre_unfreeze"
    assert report["checks"]["gate_disabled"] is True
    assert report["checks"]["backbone_copy_envelope_parity"] is True
    assert report["checks"]["backbone_replace_envelope_parity"] is True
    assert report["checks"]["row_counts_changed_during_smoke"] is True
    assert report["checks"]["row_counts_restored_after_rollback"] is True
    assert report["checks"]["project_counts_restored_after_rollback"] is True
    assert report["pre_counts"] == report["post_counts"]
    assert report["pre_counts"] != report["smoke_counts"]
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


async def test_rollback_smoke_reuses_populated_canary_sqlite(
    monkeypatch, sqlite_factory: async_sessionmaker[AsyncSession]
) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    await _seed_populated_canary(sqlite_factory)
    baseline_counts = await _truth_counts(sqlite_factory)

    first = await verify_phase4_writer.build_smoke_report(
        rollback=True, session_factory=sqlite_factory
    )
    second = await verify_phase4_writer.build_smoke_report(
        rollback=True, session_factory=sqlite_factory
    )

    assert first["status"] == "PASS"
    assert second["status"] == "PASS"
    assert first["pre_counts"] == baseline_counts
    assert first["post_counts"] == baseline_counts
    assert second["pre_counts"] == baseline_counts
    assert second["post_counts"] == baseline_counts
    assert first["pre_counts"] == first["post_counts"]
    assert second["pre_counts"] == second["post_counts"]
    assert first["pre_counts"] == second["pre_counts"]
    assert first["checks"]["row_counts_changed_during_smoke"] is True
    assert first["checks"]["row_counts_restored_after_rollback"] is True
    assert first["checks"]["project_counts_restored_after_rollback"] is True
    assert first["seed"]["device_type_code"] == "LOGIC"
    assert first["seed"]["project_category_code"] == "DEVELOPMENT"
    assert first["seed"]["source_part_id"] != second["seed"]["source_part_id"]
    assert first["seed"]["target_part_id"] != second["seed"]["target_part_id"]
    assert first["seed"]["number_parameter_code"] != second["seed"]["number_parameter_code"]
    assert first["seed"]["choice_parameter_code"] != second["seed"]["choice_parameter_code"]
    assert first["seed"]["capture_category_code"].startswith("photo_")
    assert first["seed"]["capture_choice_set_code"].startswith("equipment_mode_")
    assert first["seed"]["number_parameter_code"].startswith("spin_speed_")
    assert first["seed"]["choice_parameter_code"].startswith("pr_type_")
    assert first["seed"]["secondary_choice_value"] == "SECONDARY"
    assert first["seed"]["choice_value"] == "PRIMARY"
    assert first["target_event_counts"] == {
        "project_create": 1,
        "backbone_copy": 1,
        "cell_update": 2,
        "condition_add": 1,
        "condition_remove": 1,
        "por_change": 1,
        "project_profile_update": 1,
        "backbone_layer_replace": 1,
    }


async def test_rollback_smoke_rejects_enabled_mutations_without_db_access(monkeypatch) -> None:
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", True)

    async def _should_not_run() -> object:
        raise AssertionError("health lookup must not run when the gate is enabled")

    monkeypatch.setattr(verify_phase4_writer, "get_phase4_writer_health", _should_not_run)

    with pytest.raises(RuntimeError, match="rollback-only smoke requires"):
        await verify_phase4_writer.build_smoke_report(rollback=True)


async def test_rollback_smoke_rejects_incompatible_health_without_db_access(
    monkeypatch,
) -> None:
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    async def _incompatible_health() -> maintenance.Phase4WriterHealthOut:
        return maintenance.Phase4WriterHealthOut(
            contract_version=1,
            db_revision="0006",
            project_mutations_enabled=False,
            pre_unfreeze_ready=False,
            runtime_state="active",
        )

    def _should_not_run() -> object:
        raise AssertionError("session factory must not run when health is incompatible")

    monkeypatch.setattr(verify_phase4_writer, "get_phase4_writer_health", _incompatible_health)

    session_factory: Any = _should_not_run

    with pytest.raises(RuntimeError, match="pre_unfreeze_ready=true"):
        await verify_phase4_writer.build_smoke_report(
            rollback=True, session_factory=session_factory
        )


async def test_rollback_smoke_rolls_back_after_injected_failure(
    monkeypatch, sqlite_factory: async_sessionmaker[AsyncSession]
) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    pre_counts = await _truth_counts(sqlite_factory)

    async def _fail_set_por(*args, **kwargs) -> None:
        raise RuntimeError("injected failure")

    monkeypatch.setattr(verify_phase4_writer.ConditionService, "set_por", _fail_set_por)

    with pytest.raises(RuntimeError, match="injected failure"):
        await verify_phase4_writer.build_smoke_report(rollback=True, session_factory=sqlite_factory)

    post_counts = await _truth_counts(sqlite_factory)
    assert post_counts == pre_counts


def test_smoke_script_has_no_commit_calls() -> None:
    _assert_no_commit_calls(Path(verify_phase4_writer.__file__).resolve())


async def test_rollback_smoke_passes_against_guarded_postgres(
    monkeypatch, pg_factory: async_sessionmaker[AsyncSession]
) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    report = await verify_phase4_writer.build_smoke_report(
        rollback=True, session_factory=pg_factory
    )

    assert report["status"] == "PASS"
    assert report["pre_counts"] == report["post_counts"]
    assert report["checks"]["row_counts_restored_after_rollback"] is True
    assert report["checks"]["backbone_copy_envelope_parity"] is True
    assert report["checks"]["backbone_replace_envelope_parity"] is True


async def test_rollback_smoke_reuses_populated_canary_postgres(
    monkeypatch, pg_factory: async_sessionmaker[AsyncSession]
) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    await _seed_populated_canary(pg_factory)
    baseline_counts = await _truth_counts(pg_factory)

    first = await verify_phase4_writer.build_smoke_report(rollback=True, session_factory=pg_factory)
    second = await verify_phase4_writer.build_smoke_report(
        rollback=True, session_factory=pg_factory
    )

    assert first["status"] == "PASS"
    assert second["status"] == "PASS"
    assert first["pre_counts"] == baseline_counts
    assert first["post_counts"] == baseline_counts
    assert second["pre_counts"] == baseline_counts
    assert second["post_counts"] == baseline_counts
    assert first["seed"]["device_type_code"] == "LOGIC"
    assert first["seed"]["project_category_code"] == "DEVELOPMENT"
    assert first["seed"]["source_part_id"] != second["seed"]["source_part_id"]
    assert first["seed"]["target_part_id"] != second["seed"]["target_part_id"]
    assert first["seed"]["number_parameter_code"] != second["seed"]["number_parameter_code"]
    assert first["seed"]["choice_parameter_code"] != second["seed"]["choice_parameter_code"]
    assert first["seed"]["secondary_choice_value"] == "SECONDARY"
    assert first["checks"]["row_counts_changed_during_smoke"] is True
    assert first["checks"]["row_counts_restored_after_rollback"] is True
    assert first["checks"]["project_counts_restored_after_rollback"] is True


async def test_rollback_smoke_fails_when_canonical_choice_set_has_no_active_option(
    monkeypatch, sqlite_factory: async_sessionmaker[AsyncSession]
) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)

    async with sqlite_factory() as session:
        device_type = ChoiceSet(code="device_type", display_name="device_type")
        device_type.options.extend(
            [
                ChoiceOption(code="LOGIC", label="Logic", is_active=False, sort_order=10),
            ]
        )
        project_category = ChoiceSet(code="project_category", display_name="project_category")
        project_category.options.extend(
            [
                ChoiceOption(
                    code="DEVELOPMENT",
                    label="Development",
                    is_active=True,
                    sort_order=10,
                ),
            ]
        )
        session.add_all([device_type, project_category])
        await session.commit()

    with pytest.raises(RuntimeError, match="canonical ChoiceSet has no active option"):
        await verify_phase4_writer.build_smoke_report(rollback=True, session_factory=sqlite_factory)


def test_main_prints_json_and_returns_zero_when_compatible(
    monkeypatch, capsys, sqlite_factory: async_sessionmaker[AsyncSession]
) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)
    monkeypatch.setattr(verify_phase4_writer, "_session_factory", lambda: sqlite_factory)

    exit_code = verify_phase4_writer.main(["--rollback"])

    assert exit_code == 0
    output = capsys.readouterr().out.strip()
    assert json.loads(output)["status"] == "PASS"
    assert json.loads(output)["mode"] == "rollback"


def test_main_emits_fail_json_and_returns_one_on_injected_failure(
    monkeypatch, capsys, sqlite_factory: async_sessionmaker[AsyncSession]
) -> None:
    async def _compatible_revision() -> str | None:
        return "0006"

    monkeypatch.setattr(maintenance, "read_app_revision", _compatible_revision)
    monkeypatch.setattr(maintenance.settings, "project_mutations_enabled", False)
    monkeypatch.setattr(verify_phase4_writer, "_session_factory", lambda: sqlite_factory)

    async def _fail_set_por(*args, **kwargs) -> None:
        raise RuntimeError("injected failure")

    monkeypatch.setattr(verify_phase4_writer.ConditionService, "set_por", _fail_set_por)

    exit_code = verify_phase4_writer.main(["--rollback"])

    assert exit_code == 1
    body = json.loads(capsys.readouterr().out)
    assert body["status"] == "FAIL"
    assert body["mode"] == "rollback"
    assert "injected failure" in body["error"]
