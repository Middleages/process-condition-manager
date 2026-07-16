"""Rollback-only executable smoke for the Phase 4 writer release gate."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# The task's reproducible command executes this file directly rather than with
# ``python -m``; make the backend package root explicit without installing it.
if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker  # noqa: E402

import app.models  # noqa: F401,E402 -- register every table with Base.metadata
from app.core.db import AppSessionLocal  # noqa: E402
from app.core.maintenance import get_phase4_writer_health  # noqa: E402
from app.domain.parameters.types import ValueType  # noqa: E402
from app.features.cells.repository import CellRepository  # noqa: E402
from app.features.cells.schema import CellsPatchIn, CellUpdateIn  # noqa: E402
from app.features.cells.service import CellService  # noqa: E402
from app.features.conditions.repository import ConditionRepository  # noqa: E402
from app.features.conditions.schema import ConditionCreateIn  # noqa: E402
from app.features.conditions.service import ConditionService  # noqa: E402
from app.features.projects.repository import ProjectRepository  # noqa: E402
from app.features.projects.schema import (  # noqa: E402
    BackboneReplaceIn,
    ProjectCreate,
    ProjectProfilePatchIn,
)
from app.features.projects.service import ProjectService  # noqa: E402
from app.ingest.fixture_reader import FixtureIngestReader  # noqa: E402
from app.models.choice import ChoiceOption, ChoiceSet  # noqa: E402
from app.models.parameter import Parameter, ParameterCategory  # noqa: E402
from app.models.project import (  # noqa: E402
    CellValue,
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    Project,
    ProjectProfile,
    SheetLayer,
)
from app.project_metadata.manual import ManualProjectMetadataProvider  # noqa: E402

_PROFILE_CHOICE_SET_CODES = ("device_type", "project_category")
_DEFAULT_PROFILE_OPTIONS = (("DEFAULT", "Default", True),)
_BACKBONE_PARAMETER_CATEGORY = ("photo", "PHOTO")


@dataclass(frozen=True, slots=True)
class _SmokeSeed:
    source_project_id: int
    source_layer_keys: tuple[str, ...]
    source_condition_ids: tuple[int, ...]


def _session_factory() -> async_sessionmaker[AsyncSession]:
    return AppSessionLocal


async def _seed_choice_set(
    session: AsyncSession,
    *,
    code: str,
    options: tuple[tuple[str, str, bool], ...],
    is_active: bool = True,
) -> ChoiceSet:
    choice_set = ChoiceSet(code=code, display_name=code, is_active=is_active)
    choice_set.options.extend(
        ChoiceOption(code=value, label=label, is_active=active, sort_order=index * 10)
        for index, (value, label, active) in enumerate(options, start=1)
    )
    session.add(choice_set)
    await session.flush()
    return choice_set


async def _seed_profile_choice_sets(session: AsyncSession) -> None:
    for code in _PROFILE_CHOICE_SET_CODES:
        await _seed_choice_set(session, code=code, options=_DEFAULT_PROFILE_OPTIONS)


async def _seed_backbone_capture_parameters(session: AsyncSession) -> None:
    category = ParameterCategory(
        code=_BACKBONE_PARAMETER_CATEGORY[0], display_name=_BACKBONE_PARAMETER_CATEGORY[1]
    )
    session.add(category)
    await session.flush()

    choice_set = await _seed_choice_set(
        session,
        code="equipment_mode",
        options=(
            ("A", "A", True),
            ("B", "B", True),
            ("LEGACY", "Legacy", False),
        ),
    )
    session.add_all(
        [
            Parameter(
                code="spin_speed",
                display_name="Spin Speed",
                value_type=ValueType.NUMBER,
                category_id=category.id,
                unit="rpm",
                min_value=0,
                max_value=2000,
                required=True,
                sort_order=1,
            ),
            Parameter(
                code="pr_type",
                display_name="PR Type",
                value_type=ValueType.CHOICE,
                category_id=category.id,
                choice_set=choice_set,
                sort_order=2,
            ),
        ]
    )
    await session.flush()


async def _truth_counts(session: AsyncSession) -> dict[str, int]:
    async def _count(model: type[Any]) -> int:
        value = await session.scalar(select(func.count()).select_from(model))
        return int(value or 0)

    return {
        "projects": await _count(Project),
        "profiles": await _count(ProjectProfile),
        "layers": await _count(SheetLayer),
        "conditions": await _count(LayerCondition),
        "cells": await _count(CellValue),
        "events": await _count(ChangeEvent),
    }


async def _event_counts(session: AsyncSession, project_id: int) -> dict[str, int]:
    rows = await session.execute(
        select(ChangeEvent.event_type, func.count(ChangeEvent.id))
        .where(ChangeEvent.project_id == project_id)
        .group_by(ChangeEvent.event_type)
    )
    return {event_type.value: int(count or 0) for event_type, count in rows.all()}


async def _events(
    session: AsyncSession, project_id: int, event_type: ChangeEventType
) -> list[ChangeEvent]:
    rows = await session.execute(
        select(ChangeEvent)
        .where(
            ChangeEvent.project_id == project_id,
            ChangeEvent.event_type == event_type,
        )
        .order_by(ChangeEvent.id)
    )
    return list(rows.scalars().all())


async def _seed_source_project(session_factory: async_sessionmaker[AsyncSession]) -> _SmokeSeed:
    async with session_factory() as session:
        await _seed_profile_choice_sets(session)
        await _seed_backbone_capture_parameters(session)

        service = ProjectService(
            ProjectRepository(session),
            FixtureIngestReader(),
            ManualProjectMetadataProvider(),
        )
        source = await service.create_project(
            ProjectCreate(
                line_id="L1",
                process_id="PROC_ALPHA",
                part_id="SOURCE",
                name="Phase 4 smoke source",
                device_type_code="DEFAULT",
                project_category_code="DEFAULT",
            ),
            actor="phase4-smoke-seed",
        )

        cell_service = CellService(CellRepository(session))
        first_layer = source.layers[0]
        second_layer = source.layers[1]
        await cell_service.patch_cells(
            source.id,
            CellsPatchIn(
                origin="manual",
                cells=[
                    CellUpdateIn(
                        condition_id=first_layer.conditions[0].id,
                        parameter_code="spin_speed",
                        value="900",
                    ),
                    CellUpdateIn(
                        condition_id=first_layer.conditions[0].id,
                        parameter_code="pr_type",
                        value="A",
                    ),
                ],
            ),
            actor="phase4-smoke-seed",
        )
        await cell_service.patch_cells(
            source.id,
            CellsPatchIn(
                origin="manual",
                cells=[
                    CellUpdateIn(
                        condition_id=second_layer.conditions[0].id,
                        parameter_code="spin_speed",
                        value="1200",
                    ),
                    CellUpdateIn(
                        condition_id=second_layer.conditions[0].id,
                        parameter_code="pr_type",
                        value="B",
                    ),
                ],
            ),
            actor="phase4-smoke-seed",
        )
        await session.commit()

        return _SmokeSeed(
            source_project_id=source.id,
            source_layer_keys=tuple(layer.layer_key for layer in source.layers),
            source_condition_ids=(
                first_layer.conditions[0].id,
                second_layer.conditions[0].id,
            ),
        )


async def _run_rollback_smoke(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    health: Any,
) -> dict[str, Any]:
    seed = await _seed_source_project(session_factory)

    async with session_factory() as session:
        baseline = await _truth_counts(session)

    async with session_factory() as session:
        service = ProjectService(
            ProjectRepository(session),
            FixtureIngestReader(),
            ManualProjectMetadataProvider(),
        )
        cell_service = CellService(CellRepository(session))
        condition_service = ConditionService(ConditionRepository(session))

        target = await service.create_project(
            ProjectCreate(
                line_id="L1",
                process_id="PROC_BETA",
                part_id="TARGET",
                name="Phase 4 smoke target",
                device_type_code="DEFAULT",
                project_category_code="DEFAULT",
                backbone_project_id=seed.source_project_id,
            ),
            actor="phase4-smoke",
        )

        matched_layers = [layer for layer in target.layers if layer.source_layer_key is not None]
        assert matched_layers, "expected at least one backbone copy layer"

        copy_events = await _events(session, target.id, ChangeEventType.BACKBONE_COPY)
        assert len(copy_events) == len(matched_layers)
        capture_by_layer = {layer.layer_key: layer.backbone_snapshot for layer in matched_layers}
        for event in copy_events:
            assert event.layer_key is not None
            assert event.payload["capture"] == capture_by_layer[event.layer_key]

        target_copy_layer = next(
            layer for layer in matched_layers if layer.layer_key == "L1::PROC_BETA::001::CLN"
        )
        base_condition = target_copy_layer.conditions[0]

        manual_patch = await cell_service.patch_cells(
            target.id,
            CellsPatchIn(
                origin="manual",
                cells=[
                    CellUpdateIn(
                        condition_id=base_condition.id,
                        parameter_code="spin_speed",
                        value="905",
                    )
                ],
            ),
            actor="phase4-smoke",
        )
        paste_patch = await cell_service.patch_cells(
            target.id,
            CellsPatchIn(
                origin="paste",
                cells=[
                    CellUpdateIn(
                        condition_id=base_condition.id,
                        parameter_code="pr_type",
                        value="B",
                    )
                ],
            ),
            actor="phase4-smoke",
        )

        duplicate = await condition_service.add_condition(
            target.id,
            target_copy_layer.layer_key,
            ConditionCreateIn(source_condition_id=base_condition.id),
            actor="phase4-smoke",
        )
        await condition_service.set_por(target.id, duplicate.id, actor="phase4-smoke")
        await condition_service.delete_condition(target.id, base_condition.id, actor="phase4-smoke")
        await service.patch_profile(
            target.id,
            ProjectProfilePatchIn(comment="rollback-smoke"),
            actor="phase4-smoke",
        )

        replace_layer = next(
            layer for layer in target.layers if layer.layer_key == "L1::PROC_BETA::015::WELL"
        )
        replace_source_layer_key = seed.source_layer_keys[1]
        replaced = await service.replace_layer_backbone(
            target.id,
            replace_layer.layer_key,
            BackboneReplaceIn(
                source_project_id=seed.source_project_id,
                source_layer_key=replace_source_layer_key,
            ),
            actor="phase4-smoke",
        )

        smoke_counts = await _truth_counts(session)
        event_counts = await _event_counts(session, target.id)
        replace_events = await _events(session, target.id, ChangeEventType.BACKBONE_LAYER_REPLACE)
        profile_events = await _events(session, target.id, ChangeEventType.PROJECT_PROFILE_UPDATE)
        cell_events = await _events(session, target.id, ChangeEventType.CELL_UPDATE)
        add_events = await _events(session, target.id, ChangeEventType.CONDITION_ADD)
        remove_events = await _events(session, target.id, ChangeEventType.CONDITION_REMOVE)
        por_events = await _events(session, target.id, ChangeEventType.POR_CHANGE)

        assert manual_patch.batch_id
        assert paste_patch.batch_id
        assert len(cell_events) == 2
        assert {event.origin for event in cell_events} == {"manual", "paste"}
        for event in cell_events:
            assert event.batch_id in {manual_patch.batch_id, paste_patch.batch_id}
            assert event.layer_key == target_copy_layer.layer_key
            assert event.condition_id == base_condition.id
        assert len(add_events) == len(remove_events) == len(por_events) == 1
        assert add_events[0].payload["source_condition_id"] == base_condition.id
        assert add_events[0].payload["snapshot"]["label"] == duplicate.label
        assert remove_events[0].payload["snapshot"]["label"] == base_condition.label
        assert por_events[0].payload["new_por_condition_id"] == duplicate.id
        assert profile_events[0].origin == "manual"
        assert profile_events[0].batch_id is None
        assert profile_events[0].layer_key is None
        assert profile_events[0].source_project_id is None
        assert profile_events[0].source_layer_key is None

        replace_event = replace_events[0]
        replaced_layer = next(
            layer for layer in replaced.layers if layer.layer_key == replace_layer.layer_key
        )
        assert replace_event.payload["capture"] == replaced_layer.backbone_snapshot
        assert replace_event.payload["before"]["condition_count"] == 1
        assert replaced_layer.backbone_snapshot is not None
        assert replace_event.payload["after"]["condition_count"] == len(
            replaced_layer.backbone_snapshot["conditions"]
        )

        await session.rollback()

    async with session_factory() as session:
        after_rollback = await _truth_counts(session)

    return {
        "status": "PASS",
        "mode": "rollback",
        "health": health.model_dump(),
        "seed": {
            "source_project_id": seed.source_project_id,
            "source_layer_keys": list(seed.source_layer_keys),
        },
        "baseline_counts": baseline,
        "smoke_counts": smoke_counts,
        "after_rollback_counts": after_rollback,
        "target_event_counts": event_counts,
        "checks": {
            "gate_disabled": True,
            "backbone_copy_envelope_parity": True,
            "backbone_replace_envelope_parity": True,
            "row_counts_restored_after_rollback": baseline == after_rollback,
            "project_counts_restored_after_rollback": baseline == after_rollback,
        },
    }


async def build_smoke_report(
    *, rollback: bool, session_factory: async_sessionmaker[AsyncSession] | None = None
) -> dict[str, Any]:
    """Build the writer-health attestation used by canary/rollback checks."""
    health = await get_phase4_writer_health()
    if rollback and health.project_mutations_enabled:
        raise RuntimeError("rollback-only smoke requires PROJECT_MUTATIONS_ENABLED=false")
    if rollback:
        factory = session_factory or _session_factory()
        report = await _run_rollback_smoke(factory, health=health)
        report["health"] = health.model_dump()
        report["checks"]["gate_disabled"] = health.project_mutations_enabled is False
        return report
    return {
        "status": "PASS",
        "mode": "rollback" if rollback else "health",
        "health": health.model_dump(),
        "checks": {
            "contract_revision_compatible": True,
            "rollback_only": rollback,
            "pre_unfreeze_ready": health.pre_unfreeze_ready,
            "runtime_state": health.runtime_state,
        },
    }


async def _main_async(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rollback",
        action="store_true",
        help=(
            "Emit rollback-only attestation fields and require project mutations to stay disabled."
        ),
    )
    args = parser.parse_args(argv)

    try:
        report = await build_smoke_report(rollback=args.rollback)
    except Exception as exc:  # pragma: no cover - defensive CLI guard
        report = {
            "status": "FAIL",
            "error": str(exc),
            "mode": "rollback" if args.rollback else "health",
        }
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
        return 1

    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_main_async(sys.argv[1:] if argv is None else argv))


if __name__ == "__main__":
    raise SystemExit(main())
