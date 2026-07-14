"""Deterministic parameter-registry snapshot contract."""

from copy import deepcopy

import pytest

import app.domain.parameters as parameter_domain
from app.domain.errors import RuleViolationError
from app.domain.parameters.snapshot import SNAPSHOT_VERSION, snapshot
from app.domain.parameters.types import ValueType

FIXED = [
    {"code": "device_type", "display_name": "Device Type", "version": 1, "options": []},
    {
        "code": "project_category",
        "display_name": "Project Category",
        "version": 1,
        "options": [],
    },
    {
        "code": "active_direction",
        "display_name": "Active Direction",
        "version": 1,
        "options": [],
    },
    {
        "code": "gate_direction",
        "display_name": "Gate Direction",
        "version": 1,
        "options": [],
    },
]


def test_snapshot_v2_deduplicates_and_keeps_inactive_labels() -> None:
    categories = [
        {"code": "photo", "display_name": "Photo", "sort_order": 10, "is_active": True}
    ]
    parameters = [
        {
            "code": "mode_b",
            "display_name": "Mode B",
            "value_type": "choice",
            "category_code": "photo",
            "choice_set_code": "equipment_mode",
            "sort_order": 20,
            "is_active": True,
        },
        {
            "code": "pitch",
            "display_name": "Pitch",
            "value_type": "number",
            "category_code": "photo",
            "min_value": "0.1",
            "max_value": "1000",
            "sort_order": 10,
            "is_active": True,
        },
        {
            "code": "mode_a",
            "display_name": "Mode A",
            "value_type": "choice",
            "category_code": "photo",
            "choice_set_code": "equipment_mode",
            "sort_order": 15,
            "is_active": True,
        },
    ]
    sets = FIXED + [
        {
            "code": "equipment_mode",
            "display_name": "Equipment Mode",
            "version": 7,
            "options": [
                {"code": "OLD", "label": "Old label", "sort_order": 20, "is_active": False},
                {"code": "AUTO", "label": "Automatic", "sort_order": 10, "is_active": True},
            ],
        },
        {"code": "unused", "display_name": "Unused", "version": 1, "options": []},
    ]

    result = snapshot(categories=categories, parameters=parameters, choice_sets=sets)

    assert result["version"] == 2
    assert [row["code"] for row in result["parameters"]] == ["pitch", "mode_a", "mode_b"]
    assert [row["code"] for row in result["choice_sets"]] == [
        "active_direction",
        "device_type",
        "equipment_mode",
        "gate_direction",
        "project_category",
    ]
    equipment = next(row for row in result["choice_sets"] if row["code"] == "equipment_mode")
    assert equipment["options"] == [
        {"code": "AUTO", "label": "Automatic", "sort_order": 10, "is_active": True},
        {"code": "OLD", "label": "Old label", "sort_order": 20, "is_active": False},
    ]
    assert "options" not in next(row for row in result["parameters"] if row["code"] == "mode_a")
    assert result == snapshot(
        categories=list(reversed(deepcopy(categories))),
        parameters=list(reversed(deepcopy(parameters))),
        choice_sets=list(reversed(deepcopy(sets))),
    )


def test_snapshot_rejects_a_missing_fixed_or_referenced_set() -> None:
    with pytest.raises(RuleViolationError) as raised:
        snapshot(categories=[], parameters=[], choice_sets=FIXED[:-1])
    assert raised.value.code == "snapshot_choice_set_missing"


def test_snapshot_filters_inactive_rows_but_keeps_an_inactive_referenced_set() -> None:
    categories = [
        {"code": "inactive", "display_name": "Inactive", "sort_order": 0, "is_active": False},
        {"code": "photo", "display_name": "Photo", "sort_order": 5, "is_active": True},
    ]
    parameters = [
        {
            "code": "hidden_mode",
            "display_name": "Hidden Mode",
            "value_type": ValueType.CHOICE,
            "choice_set_code": "missing_but_inactive",
            "sort_order": 0,
            "is_active": False,
        },
        {
            "code": "pitch",
            "display_name": "Pitch",
            "value_type": ValueType.NUMBER,
            "category_code": "photo",
            "unit": "um",
            "min_value": "0.1000",
            "max_value": "1000.000",
            "sort_order": 5,
            "is_active": True,
        },
        {
            "code": "mode_a",
            "display_name": "Mode A",
            "value_type": ValueType.CHOICE,
            "category_code": "photo",
            "choice_set_code": "equipment_mode",
            "sort_order": 10,
            "is_active": True,
        },
        {
            "code": "mode_b",
            "display_name": "Mode B",
            "value_type": "choice",
            "category_code": "photo",
            "choice_set_code": "equipment_mode",
            "sort_order": 20,
            "is_active": True,
        },
    ]
    sets = FIXED + [
        {
            "code": "equipment_mode",
            "display_name": "Equipment Mode",
            "version": "7",
            "is_active": False,
            "options": [
                {"code": "MANUAL", "label": "Manual", "sort_order": 20, "is_active": True},
                {"code": "AUTO", "label": "Automatic", "sort_order": 10, "is_active": True},
            ],
        },
        {"code": "unused", "display_name": "Unused", "version": 1, "options": []},
    ]

    result = snapshot(categories=categories, parameters=parameters, choice_sets=sets)

    assert result["categories"] == [
        {"code": "photo", "display_name": "Photo", "sort_order": 5}
    ]
    assert [row["code"] for row in result["parameters"]] == ["pitch", "mode_a", "mode_b"]
    pitch = result["parameters"][0]
    assert pitch == {
        "code": "pitch",
        "display_name": "Pitch",
        "value_type": "number",
        "category_code": "photo",
        "unit": "um",
        "min_value": "0.1000",
        "max_value": "1000.000",
        "sort_order": 5,
    }
    assert "choice_set_code" not in pitch
    assert result["parameters"][1]["choice_set_code"] == "equipment_mode"
    assert [row["code"] for row in result["choice_sets"]].count("equipment_mode") == 1
    assert "unused" not in {row["code"] for row in result["choice_sets"]}
    equipment = next(row for row in result["choice_sets"] if row["code"] == "equipment_mode")
    assert equipment == {
        "code": "equipment_mode",
        "display_name": "Equipment Mode",
        "version": 7,
        "options": [
            {"code": "AUTO", "label": "Automatic", "sort_order": 10, "is_active": True},
            {"code": "MANUAL", "label": "Manual", "sort_order": 20, "is_active": True},
        ],
    }


def test_snapshot_rejects_a_missing_active_parameter_set() -> None:
    parameters = [
        {
            "code": "mode",
            "display_name": "Mode",
            "value_type": "choice",
            "choice_set_code": "equipment_mode",
        }
    ]

    with pytest.raises(RuleViolationError) as raised:
        snapshot(categories=[], parameters=parameters, choice_sets=FIXED)

    assert raised.value.code == "snapshot_choice_set_missing"
    assert "equipment_mode" in raised.value.message


def test_snapshot_and_version_are_public_parameter_domain_exports() -> None:
    assert parameter_domain.snapshot is snapshot
    assert parameter_domain.SNAPSHOT_VERSION == SNAPSHOT_VERSION == 2
