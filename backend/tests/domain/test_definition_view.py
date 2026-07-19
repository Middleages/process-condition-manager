"""DefinitionView parser contract tests."""

from __future__ import annotations

import copy

import pytest

from app.core.errors import DomainValidationError
from app.domain.parameters.definition_view import DefinitionView
from app.domain.parameters.snapshot import snapshot_digest

_VALID_SNAPSHOT: dict[str, object] = {
    "version": 3,
    "categories": [],
    "parameters": [],
    "choice_sets": [],
    "validation_rules": [],
}
_VALID_SNAPSHOT["validation_basis_hash"] = snapshot_digest(_VALID_SNAPSHOT)


def test_from_snapshot_requires_mapping() -> None:
    with pytest.raises(DomainValidationError) as exc:
        DefinitionView.from_snapshot([1, 2, 3])
    assert exc.value.code == "snapshot_invalid"


def test_from_snapshot_requires_version_and_required_fields() -> None:
    bad = dict(_VALID_SNAPSHOT)
    bad["version"] = 2
    with pytest.raises(DomainValidationError) as exc:
        DefinitionView.from_snapshot(bad)
    assert exc.value.code == "snapshot_invalid"


def test_from_snapshot_rejects_non_iterable_section_types() -> None:
    bad = dict(_VALID_SNAPSHOT)
    bad["parameters"] = "not-a-list"
    with pytest.raises(DomainValidationError) as exc:
        DefinitionView.from_snapshot(bad)
    assert exc.value.code == "snapshot_invalid"


def test_from_snapshot_rejects_invalid_hash_format() -> None:
    bad = dict(_VALID_SNAPSHOT)
    bad["validation_basis_hash"] = "md5:abc"
    with pytest.raises(DomainValidationError) as exc:
        DefinitionView.from_snapshot(bad)
    assert exc.value.code == "snapshot_invalid"


def test_from_snapshot_success() -> None:
    view = DefinitionView.from_snapshot(dict(_VALID_SNAPSHOT))
    assert view.validation_basis_hash == _VALID_SNAPSHOT["validation_basis_hash"]
    assert view.columns() == []
    assert view.rules() == []
    assert view.frozen_choice_sets() == []


def test_columns_derive_choice_set_version_from_choice_sets() -> None:
    snapshot: dict[str, object] = {
        "version": 3,
        "categories": [],
        "parameters": [
            {
                "code": "mode",
                "display_name": "Mode",
                "value_type": "choice",
                "choice_set_code": "equipment_mode",
                "description": None,
                "category_code": None,
                "unit": None,
                "min_value": None,
                "max_value": None,
                "required": False,
                "pattern": None,
                "pattern_hint": None,
                "sort_order": 1,
            }
        ],
        "choice_sets": [
            {
                "code": "equipment_mode",
                "display_name": "Equipment Mode",
                "version": 4,
                "is_active": True,
                "options": [
                    {"code": "A", "label": "A", "sort_order": 1, "is_active": True}
                ],
            }
        ],
        "validation_rules": [],
    }
    snapshot["validation_basis_hash"] = snapshot_digest(snapshot)

    view = DefinitionView.from_snapshot(snapshot)
    [column] = view.columns()
    assert column["choice_set_version"] == 4


def test_from_snapshot_rejects_tampered_content_with_stale_digest() -> None:
    snapshot = copy.deepcopy(_VALID_SNAPSHOT)
    snapshot["categories"] = [{"code": "x", "display_name": "X", "sort_order": 0}]
    with pytest.raises(DomainValidationError) as exc:
        DefinitionView.from_snapshot(snapshot)
    assert exc.value.code == "snapshot_invalid"
