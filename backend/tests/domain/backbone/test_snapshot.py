"""Exact backbone snapshot v1 contract."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

import app.domain.backbone as backbone_domain
from app.domain.backbone.snapshot import (
    BASELINE_UNAVAILABLE,
    INVALID_BACKBONE_SNAPSHOT,
    SNAPSHOT_VERSION,
    UNRESOLVED_PARAMETER_METADATA,
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
    backbone_snapshot_hash,
    format_captured_at,
    new_capture_batch_id,
    normalize_capture_batch_id,
    normalize_captured_at,
    parse_backbone_snapshot,
    serialize_backbone_snapshot,
    snapshot,
)
from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType


def _raw_snapshot(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    raw: dict[str, Any] = {
        "schema_version": 1,
        "capture_batch_id": "0123456789abcdef0123456789abcdef",
        "captured_at": "2026-07-16T04:17:58.715Z",
        "source": {
            "project_id": 42,
            "sheet_layer_id": 7,
            "layer_key": "L1::PROC_ALPHA::010::ACT",
            "step_seq": "010",
            "layer_id": "ACT",
        },
        "columns": [
            {
                "parameter_code": "notes",
                "value_type": "text",
                "display_name": "Notes",
                "category_code": None,
                "sort_order": 3,
                "active_at_capture": True,
            },
            {
                "parameter_code": "width",
                "value_type": "number",
                "display_name": "Width",
                "category_code": "dim",
                "sort_order": 2,
                "active_at_capture": True,
            },
            {
                "parameter_code": "pitch",
                "value_type": "number",
                "display_name": "Pitch",
                "category_code": "dim",
                "sort_order": 1,
                "active_at_capture": True,
            },
            {
                "parameter_code": "material",
                "value_type": "choice",
                "display_name": "Material",
                "category_code": "proc",
                "sort_order": 1,
                "active_at_capture": False,
            },
            {
                "parameter_code": "overlay",
                "value_type": "text",
                "display_name": "Overlay",
                "category_code": "meta",
                "sort_order": 4,
                "active_at_capture": True,
            },
        ],
        "conditions": [
            {
                "source_condition_id": 20,
                "label": "Line B",
                "condition_index": 1,
                "is_por": False,
                "cells": {
                    "width": "01.000",
                    "material": "AL",
                },
            },
            {
                "source_condition_id": 10,
                "label": "Line A",
                "condition_index": 0,
                "is_por": True,
                "cells": {
                    "pitch": "1.0",
                    "notes": "primary",
                },
            },
        ],
    }
    if overrides:
        for key, value in overrides.items():
            raw[key] = value
    return raw


def _semantic_snapshot_a() -> BackboneSnapshot:
    return BackboneSnapshot(
        schema_version=1,
        capture_batch_id="0123456789abcdef0123456789abcdef",
        captured_at="2026-07-16T04:17:58.715000Z",
        source=BackboneSnapshotSource(
            project_id=42,
            sheet_layer_id=7,
            layer_key="L1::PROC_ALPHA::010::ACT",
            step_seq="010",
            layer_id="ACT",
        ),
        columns=(
            BackboneSnapshotColumn(
                parameter_code="overlay",
                value_type=ValueType.TEXT,
                display_name="Overlay",
                category_code="meta",
                sort_order=4,
                active_at_capture=True,
            ),
            BackboneSnapshotColumn(
                parameter_code="notes",
                value_type=ValueType.TEXT,
                display_name="Notes",
                category_code=None,
                sort_order=3,
                active_at_capture=True,
            ),
            BackboneSnapshotColumn(
                parameter_code="width",
                value_type=ValueType.NUMBER,
                display_name="Width",
                category_code="dim",
                sort_order=2,
                active_at_capture=True,
            ),
            BackboneSnapshotColumn(
                parameter_code="material",
                value_type=ValueType.CHOICE,
                display_name="Material",
                category_code="proc",
                sort_order=1,
                active_at_capture=False,
            ),
            BackboneSnapshotColumn(
                parameter_code="pitch",
                value_type=ValueType.NUMBER,
                display_name="Pitch",
                category_code="dim",
                sort_order=1,
                active_at_capture=True,
            ),
        ),
        conditions=(
            BackboneSnapshotCondition(
                source_condition_id=20,
                label="Line B",
                condition_index=1,
                is_por=False,
                cells=(
                    BackboneSnapshotCell(parameter_code="width", value="1.00"),
                    BackboneSnapshotCell(parameter_code="material", value="AL"),
                ),
            ),
            BackboneSnapshotCondition(
                source_condition_id=10,
                label="Line A",
                condition_index=0,
                is_por=True,
                cells=(
                    BackboneSnapshotCell(parameter_code="notes", value="primary"),
                    BackboneSnapshotCell(parameter_code="pitch", value="01.000"),
                ),
            ),
        ),
    )


def _semantic_snapshot_b() -> BackboneSnapshot:
    return BackboneSnapshot(
        schema_version=1,
        capture_batch_id="0123456789abcdef0123456789abcdef",
        captured_at="2026-07-16T04:17:58.715Z",
        source=BackboneSnapshotSource(
            project_id=42,
            sheet_layer_id=7,
            layer_key="L1::PROC_ALPHA::010::ACT",
            step_seq="010",
            layer_id="ACT",
        ),
        columns=(
            BackboneSnapshotColumn(
                parameter_code="material",
                value_type="choice",
                display_name="Material",
                category_code="proc",
                sort_order=1,
                active_at_capture=False,
            ),
            BackboneSnapshotColumn(
                parameter_code="pitch",
                value_type="number",
                display_name="Pitch",
                category_code="dim",
                sort_order=1,
                active_at_capture=True,
            ),
            BackboneSnapshotColumn(
                parameter_code="width",
                value_type="number",
                display_name="Width",
                category_code="dim",
                sort_order=2,
                active_at_capture=True,
            ),
            BackboneSnapshotColumn(
                parameter_code="notes",
                value_type="text",
                display_name="Notes",
                category_code=None,
                sort_order=3,
                active_at_capture=True,
            ),
            BackboneSnapshotColumn(
                parameter_code="overlay",
                value_type="text",
                display_name="Overlay",
                category_code="meta",
                sort_order=4,
                active_at_capture=True,
            ),
        ),
        conditions=(
            BackboneSnapshotCondition(
                source_condition_id=10,
                label="Line A",
                condition_index=0,
                is_por=True,
                cells=(
                    BackboneSnapshotCell(parameter_code="pitch", value="1.0"),
                    BackboneSnapshotCell(parameter_code="notes", value="primary"),
                ),
            ),
            BackboneSnapshotCondition(
                source_condition_id=20,
                label="Line B",
                condition_index=1,
                is_por=False,
                cells=(
                    BackboneSnapshotCell(parameter_code="material", value="AL"),
                    BackboneSnapshotCell(parameter_code="width", value="1"),
                ),
            ),
        ),
    )


def test_snapshot_serializes_exact_contract_from_shuffled_input() -> None:
    raw = _raw_snapshot()

    parsed = parse_backbone_snapshot(raw)
    assert [column.parameter_code for column in parsed.columns] == [
        "material",
        "pitch",
        "width",
        "notes",
        "overlay",
    ]
    assert [condition.source_condition_id for condition in parsed.conditions] == [10, 20]
    assert [cell.parameter_code for cell in parsed.conditions[0].cells] == ["notes", "pitch"]
    assert [cell.parameter_code for cell in parsed.conditions[1].cells] == ["material", "width"]

    result = serialize_backbone_snapshot(raw)
    assert result == {
        "schema_version": 1,
        "capture_batch_id": "0123456789abcdef0123456789abcdef",
        "captured_at": "2026-07-16T04:17:58.715Z",
        "source": {
            "project_id": 42,
            "sheet_layer_id": 7,
            "layer_key": "L1::PROC_ALPHA::010::ACT",
            "step_seq": "010",
            "layer_id": "ACT",
        },
        "columns": [
            {
                "parameter_code": "material",
                "value_type": "choice",
                "display_name": "Material",
                "category_code": "proc",
                "sort_order": 1,
                "active_at_capture": False,
            },
            {
                "parameter_code": "pitch",
                "value_type": "number",
                "display_name": "Pitch",
                "category_code": "dim",
                "sort_order": 1,
                "active_at_capture": True,
            },
            {
                "parameter_code": "width",
                "value_type": "number",
                "display_name": "Width",
                "category_code": "dim",
                "sort_order": 2,
                "active_at_capture": True,
            },
            {
                "parameter_code": "notes",
                "value_type": "text",
                "display_name": "Notes",
                "category_code": None,
                "sort_order": 3,
                "active_at_capture": True,
            },
            {
                "parameter_code": "overlay",
                "value_type": "text",
                "display_name": "Overlay",
                "category_code": "meta",
                "sort_order": 4,
                "active_at_capture": True,
            },
        ],
        "conditions": [
            {
                "source_condition_id": 10,
                "label": "Line A",
                "condition_index": 0,
                "is_por": True,
                "cells": {
                    "notes": "primary",
                    "pitch": "1",
                },
            },
            {
                "source_condition_id": 20,
                "label": "Line B",
                "condition_index": 1,
                "is_por": False,
                "cells": {
                    "material": "AL",
                    "width": "1",
                },
            },
        ],
    }
    assert result == snapshot(deepcopy(raw))
    assert backbone_snapshot_hash(raw) == backbone_snapshot_hash(parsed) == backbone_snapshot_hash(
        BackboneSnapshot(
            schema_version=1,
            capture_batch_id="0123456789abcdef0123456789abcdef",
            captured_at="2026-07-16T04:17:58.715000Z",
            source=BackboneSnapshotSource(
                project_id=42,
                sheet_layer_id=7,
                layer_key="L1::PROC_ALPHA::010::ACT",
                step_seq="010",
                layer_id="ACT",
            ),
            columns=(
                BackboneSnapshotColumn(
                    parameter_code="overlay",
                    value_type=ValueType.TEXT,
                    display_name="Overlay",
                    category_code="meta",
                    sort_order=4,
                    active_at_capture=True,
                ),
                BackboneSnapshotColumn(
                    parameter_code="width",
                    value_type=ValueType.NUMBER,
                    display_name="Width",
                    category_code="dim",
                    sort_order=2,
                    active_at_capture=True,
                ),
                BackboneSnapshotColumn(
                    parameter_code="material",
                    value_type=ValueType.CHOICE,
                    display_name="Material",
                    category_code="proc",
                    sort_order=1,
                    active_at_capture=False,
                ),
                BackboneSnapshotColumn(
                    parameter_code="pitch",
                    value_type=ValueType.NUMBER,
                    display_name="Pitch",
                    category_code="dim",
                    sort_order=1,
                    active_at_capture=True,
                ),
                BackboneSnapshotColumn(
                    parameter_code="notes",
                    value_type=ValueType.TEXT,
                    display_name="Notes",
                    category_code=None,
                    sort_order=3,
                    active_at_capture=True,
                ),
            ),
            conditions=(
                BackboneSnapshotCondition(
                    source_condition_id=20,
                    label="Line B",
                    condition_index=1,
                    is_por=False,
                    cells=(
                        BackboneSnapshotCell(parameter_code="width", value="1.00"),
                        BackboneSnapshotCell(parameter_code="material", value="AL"),
                    ),
                ),
                BackboneSnapshotCondition(
                    source_condition_id=10,
                    label="Line A",
                    condition_index=0,
                    is_por=True,
                    cells=(
                        BackboneSnapshotCell(parameter_code="pitch", value="01.000"),
                        BackboneSnapshotCell(parameter_code="notes", value="primary"),
                    ),
                ),
            ),
        )
    )


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda raw: raw.pop("schema_version"), INVALID_BACKBONE_SNAPSHOT),
        (lambda raw: raw.__setitem__("schema_version", 2), INVALID_BACKBONE_SNAPSHOT),
        (lambda raw: raw.__setitem__("schema_version", True), INVALID_BACKBONE_SNAPSHOT),
        (lambda raw: raw.__setitem__("schema_version", "1"), INVALID_BACKBONE_SNAPSHOT),
        (
            lambda raw: raw["source"].__setitem__("project_id", "42"),
            INVALID_BACKBONE_SNAPSHOT,
        ),
        (lambda raw: raw.__setitem__("columns", {}), INVALID_BACKBONE_SNAPSHOT),
        (lambda raw: raw.__setitem__("conditions", {}), INVALID_BACKBONE_SNAPSHOT),
        (
            lambda raw: raw["conditions"][0]["cells"].__setitem__("width", "not-a-number"),
            INVALID_BACKBONE_SNAPSHOT,
        ),
        (
            lambda raw: raw["conditions"][0]["cells"].__setitem__("missing", "1"),
            UNRESOLVED_PARAMETER_METADATA,
        ),
        (
            lambda raw: raw["conditions"].__setitem__(
                0,
                {
                    "source_condition_id": 10,
                    "label": "Line A",
                    "condition_index": 0,
                    "is_por": True,
                    "cells": [],
                },
            ),
            INVALID_BACKBONE_SNAPSHOT,
        ),
        (
            lambda raw: raw["columns"].append(
                {
                    "parameter_code": "width",
                    "value_type": "number",
                    "display_name": "Duplicate",
                    "category_code": "dim",
                    "sort_order": 5,
                    "active_at_capture": True,
                }
            ),
            INVALID_BACKBONE_SNAPSHOT,
        ),
        (
            lambda raw: raw["conditions"].append(
                {
                    "source_condition_id": 10,
                    "label": "Dup",
                    "condition_index": 2,
                    "is_por": False,
                    "cells": {"notes": "x"},
                }
            ),
            INVALID_BACKBONE_SNAPSHOT,
        ),
        (lambda raw: raw.__setitem__("extra", "value"), INVALID_BACKBONE_SNAPSHOT),
        (
            lambda raw: raw["columns"].__setitem__(0, {**raw["columns"][0], "value_type": "bogus"}),
            INVALID_BACKBONE_SNAPSHOT,
        ),
        (
            lambda raw: raw["conditions"].append(
                {
                    "source_condition_id": 30,
                    "label": "Dup",
                    "condition_index": 1,
                    "is_por": False,
                    "cells": {"notes": "x"},
                }
            ),
            INVALID_BACKBONE_SNAPSHOT,
        ),
    ],
)
def test_snapshot_parser_fails_closed_on_invalid_contract_data(
    mutate,
    code: str,
) -> None:
    raw = _raw_snapshot()
    mutate(raw)

    with pytest.raises(RuleViolationError) as raised:
        parse_backbone_snapshot(raw)

    assert raised.value.code == code


def test_snapshot_contract_helpers_and_hashing_are_canonical() -> None:
    snapshot_a = _semantic_snapshot_a()
    snapshot_b = _semantic_snapshot_b()

    assert new_capture_batch_id().isascii()
    assert len(new_capture_batch_id()) == 32
    assert normalize_capture_batch_id("0123456789abcdef0123456789abcdef") == (
        "0123456789abcdef0123456789abcdef"
    )

    with pytest.raises(RuleViolationError):
        normalize_capture_batch_id("0123456789ABCDEF0123456789ABCDEF")

    assert normalize_captured_at(datetime(2026, 7, 16, 4, 17, 58, 715000, tzinfo=timezone.utc)) == datetime(
        2026,
        7,
        16,
        4,
        17,
        58,
        715000,
        tzinfo=timezone.utc,
    )
    assert format_captured_at(
        datetime(2026, 7, 16, 4, 17, 58, 715000, tzinfo=timezone.utc)
    ) == "2026-07-16T04:17:58.715Z"

    with pytest.raises(RuleViolationError):
        normalize_captured_at(datetime(2026, 7, 16, 4, 17, 58, tzinfo=timezone(timedelta(hours=9))))

    assert serialize_backbone_snapshot(snapshot_a) == serialize_backbone_snapshot(snapshot_b)
    assert backbone_snapshot_hash(snapshot_a) == backbone_snapshot_hash(snapshot_b)


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        (None, BASELINE_UNAVAILABLE),
        ([], INVALID_BACKBONE_SNAPSHOT),
        ({"schema_version": 1, "capture_batch_id": "bad", "captured_at": "2026-07-16T04:17:58.715Z", "source": {}, "columns": [], "conditions": []}, INVALID_BACKBONE_SNAPSHOT),
        (_raw_snapshot({"captured_at": "2026-07-16T04:17:58.715+09:00"}), INVALID_BACKBONE_SNAPSHOT),
        (_raw_snapshot({"captured_at": "2026-07-16T04:17:58.715000Z"}), INVALID_BACKBONE_SNAPSHOT),
    ],
)
def test_snapshot_null_and_malformed_inputs_fail_closed(raw: Any, code: str) -> None:
    with pytest.raises(RuleViolationError) as raised:
        parse_backbone_snapshot(raw)

    assert raised.value.code == code


def test_snapshot_domain_exports_surface_contract() -> None:
    assert backbone_domain.snapshot is snapshot
    assert backbone_domain.SNAPSHOT_VERSION == SNAPSHOT_VERSION == 1
    assert backbone_domain.BackboneSnapshot is BackboneSnapshot
    assert backbone_domain.BackboneSnapshotSource is BackboneSnapshotSource
    assert backbone_domain.BackboneSnapshotColumn is BackboneSnapshotColumn
    assert backbone_domain.BackboneSnapshotCondition is BackboneSnapshotCondition
    assert backbone_domain.BackboneSnapshotCell is BackboneSnapshotCell
    assert backbone_domain.parse_backbone_snapshot is parse_backbone_snapshot
    assert backbone_domain.serialize_backbone_snapshot is serialize_backbone_snapshot
    assert backbone_domain.backbone_snapshot_hash is backbone_snapshot_hash
