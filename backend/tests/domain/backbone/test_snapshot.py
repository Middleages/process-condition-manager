"""Deterministic backbone snapshot contract."""

from copy import deepcopy
from typing import Any

import pytest

import app.domain.backbone as backbone_domain
from app.domain.backbone.snapshot import (
    SNAPSHOT_VERSION,
    BackboneCellValue,
    BackboneConditionSnapshot,
    BackboneSnapshotSpec,
    BackboneSourceLayer,
    BackboneSourceProject,
    snapshot,
)
from app.domain.errors import RuleViolationError


@pytest.fixture
def captured_graph_spec() -> BackboneSnapshotSpec:
    return BackboneSnapshotSpec(
        source_project=BackboneSourceProject(
            project_id=42,
            line_id="L1",
            process_id="PROC_ALPHA",
            part_id="PART_A",
        ),
        source_layer=BackboneSourceLayer(
            layer_key="L1::PROC_ALPHA::010::ACT",
            step_seq="010",
            layer_id="ACT",
            eqp_type="PHOTO",
            area_name="PHOTO",
        ),
        captured_at="2026-07-16T04:17:58.715Z",
        conditions=(
            BackboneConditionSnapshot(
                condition_id=20,
                label="Line B",
                condition_index=1,
                is_por=False,
                cell_values=(
                    BackboneCellValue(parameter_code="thickness", value_text="10.000"),
                    BackboneCellValue(parameter_code="notes", value_text=None),
                    BackboneCellValue(parameter_code="material", value_text="Si"),
                ),
            ),
            BackboneConditionSnapshot(
                condition_id=10,
                label="Line A",
                condition_index=0,
                is_por=True,
                cell_values=(
                    BackboneCellValue(parameter_code="notes", value_text="primary"),
                    BackboneCellValue(parameter_code="pitch", value_text="0.100"),
                ),
            ),
        ),
    )


@pytest.fixture
def captured_graph(captured_graph_spec: BackboneSnapshotSpec) -> dict[str, Any]:
    latest_snapshot = snapshot(captured_graph_spec)
    target_rows = _target_rows_from_snapshot(latest_snapshot)
    event_details = _event_details_from_target_rows(target_rows)
    return {
        "latest_snapshot": latest_snapshot,
        "target_rows": target_rows,
        "event_details": event_details,
    }


def test_snapshot_v1_serializes_identity_and_sparse_cells_deterministically() -> None:
    spec = BackboneSnapshotSpec(
        source_project=BackboneSourceProject(
            project_id=42,
            line_id="L1",
            process_id="PROC_ALPHA",
            part_id="PART_A",
        ),
        source_layer=BackboneSourceLayer(
            layer_key="L1::PROC_ALPHA::010::ACT",
            step_seq="010",
            layer_id="ACT",
            eqp_type="PHOTO",
            area_name="PHOTO",
        ),
        captured_at="2026-07-16T04:17:58.715Z",
        conditions=(
            BackboneConditionSnapshot(
                condition_id=20,
                label="Line B",
                condition_index=1,
                is_por=False,
                cell_values=(
                    BackboneCellValue(parameter_code="thickness", value_text="10.000"),
                    BackboneCellValue(parameter_code="notes", value_text=None),
                    BackboneCellValue(parameter_code="material", value_text="Si"),
                ),
            ),
            BackboneConditionSnapshot(
                condition_id=10,
                label="Line A",
                condition_index=0,
                is_por=True,
                cell_values=(
                    BackboneCellValue(parameter_code="notes", value_text="primary"),
                    BackboneCellValue(parameter_code="pitch", value_text="0.100"),
                ),
            ),
        ),
    )

    result = snapshot(spec)

    assert result == {
        "version": 1,
        "captured_at": "2026-07-16T04:17:58.715Z",
        "source_project": {
            "project_id": 42,
            "line_id": "L1",
            "process_id": "PROC_ALPHA",
            "part_id": "PART_A",
        },
        "source_layer": {
            "layer_key": "L1::PROC_ALPHA::010::ACT",
            "step_seq": "010",
            "layer_id": "ACT",
            "eqp_type": "PHOTO",
            "area_name": "PHOTO",
        },
        "conditions": [
            {
                "condition_id": 10,
                "label": "Line A",
                "condition_index": 0,
                "is_por": True,
                "cells": {"notes": "primary", "pitch": "0.100"},
            },
            {
                "condition_id": 20,
                "label": "Line B",
                "condition_index": 1,
                "is_por": False,
                "cells": {"material": "Si", "thickness": "10.000"},
            },
        ],
    }
    assert result == snapshot(deepcopy(spec))


def test_snapshot_v1_rejects_invalid_or_duplicate_contract_data() -> None:
    with pytest.raises(RuleViolationError) as raised:
        snapshot(
            BackboneSnapshotSpec(
                source_project=BackboneSourceProject(
                    project_id=1,
                    line_id="L1",
                    process_id="PROC_ALPHA",
                    part_id="PART_A",
                ),
                source_layer=BackboneSourceLayer(
                    layer_key="",
                    step_seq="010",
                    layer_id="ACT",
                ),
                captured_at="2026-07-16T04:17:58.715Z",
            )
        )
    assert raised.value.code == "backbone_snapshot_invalid"

    with pytest.raises(RuleViolationError) as raised:
        snapshot(
            BackboneSnapshotSpec(
                source_project=BackboneSourceProject(
                    project_id=1,
                    line_id="L1",
                    process_id="PROC_ALPHA",
                    part_id="PART_A",
                ),
                source_layer=BackboneSourceLayer(
                    layer_key="L1::PROC_ALPHA::010::ACT",
                    step_seq="010",
                    layer_id="ACT",
                ),
                captured_at="2026-07-16T04:17:58.715Z",
                conditions=(
                    BackboneConditionSnapshot(
                        condition_id=1,
                        label="base",
                        condition_index=0,
                        is_por=True,
                        cell_values=(
                            BackboneCellValue(parameter_code="pitch", value_text="0.100"),
                            BackboneCellValue(parameter_code="pitch", value_text="0.200"),
                        ),
                    ),
                ),
            )
        )
    assert raised.value.code == "backbone_snapshot_invalid"


def test_backbone_domain_exports_surface_contract() -> None:
    assert backbone_domain.snapshot is snapshot
    assert backbone_domain.SNAPSHOT_VERSION == SNAPSHOT_VERSION == 1
    assert backbone_domain.BackboneSourceProject is BackboneSourceProject
    assert backbone_domain.BackboneSourceLayer is BackboneSourceLayer


def test_captured_graph_fixture_drives_target_rows_snapshot_and_events(
    captured_graph: dict[str, Any],
) -> None:
    latest_snapshot = captured_graph["latest_snapshot"]
    target_rows = captured_graph["target_rows"]
    event_details = captured_graph["event_details"]

    assert latest_snapshot["conditions"] == [
        {
            "condition_id": 10,
            "label": "Line A",
            "condition_index": 0,
            "is_por": True,
            "cells": {"notes": "primary", "pitch": "0.100"},
        },
        {
            "condition_id": 20,
            "label": "Line B",
            "condition_index": 1,
            "is_por": False,
            "cells": {"material": "Si", "thickness": "10.000"},
        },
    ]
    assert [row["target_condition_id"] for row in target_rows] == [1010, 1020]
    assert [row["source_condition_id"] for row in target_rows] == [10, 20]
    assert [row["label"] for row in target_rows] == ["Line A", "Line B"]
    assert [row["cells"] for row in target_rows] == [
        {"notes": "primary", "pitch": "0.100"},
        {"material": "Si", "thickness": "10.000"},
    ]
    assert [event["target_condition_id"] for event in event_details] == [1010, 1020]
    assert [event["source_condition_id"] for event in event_details] == [10, 20]
    assert all(
        event["target_condition_id"] != event["source_condition_id"]
        for event in event_details
    )
    assert [event["event_type"] for event in event_details] == [
        "backbone_copy",
        "backbone_copy",
    ]


def _target_rows_from_snapshot(latest_snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for condition in latest_snapshot["conditions"]:
        source_condition_id = condition["condition_id"]
        rows.append(
            {
                "target_condition_id": 1000 + source_condition_id,
                "source_condition_id": source_condition_id,
                "label": condition["label"],
                "cells": condition["cells"],
            }
        )
    return rows


def _event_details_from_target_rows(
    target_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        {
            "event_type": "backbone_copy",
            "target_condition_id": row["target_condition_id"],
            "source_condition_id": row["source_condition_id"],
            "label": row["label"],
            "cells": row["cells"],
        }
        for row in target_rows
    ]
