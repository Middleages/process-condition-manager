from __future__ import annotations

import base64
import json
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from fastapi import Request
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.errors import AppError, ConflictError
from app.domain.backbone.diff import (
    BackboneDiffCellChange,
    BackboneDiffCurrentCell,
    BackboneDiffCurrentCondition,
    BackboneDiffCurrentLayerSource,
    BackboneDiffCurrentParameter,
    BackboneDiffLayerInput,
    BackboneDiffMetadataChange,
    BackboneDiffRow,
)
from app.domain.backbone.snapshot import (
    BackboneSnapshot,
    BackboneSnapshotCell,
    BackboneSnapshotColumn,
    BackboneSnapshotCondition,
    BackboneSnapshotSource,
    serialize_backbone_snapshot,
)
from app.domain.errors import RuleViolationError
from app.domain.parameters.types import ValueType
from app.features.backbone_diff.contracts import BackboneDiffProjectInput
from app.features.backbone_diff.cursor import (
    BackboneDiffBranchScope,
    BackboneDiffCellScope,
    BackboneDiffCursor,
    BackboneDiffFilters,
    BackboneDiffRootScope,
    BackboneDiffRowRef,
    decode_backbone_diff_cursor,
    decode_backbone_diff_row_ref,
    decode_backbone_diff_scope,
    encode_backbone_diff_cursor,
    encode_backbone_diff_row_ref,
    encode_backbone_diff_scope,
)
from app.features.backbone_diff.provider import BackboneDiffProvider, _LayerBundle
from app.features.backbone_diff.schema import BackboneDiffRootQueryIn
from app.models.parameter import Parameter, ParameterCategory
from app.models.project import CellValue, LayerCondition, Project, SheetLayer
from tests.factories import make_project_profile

_VALID_BASIS_HASH = "sha256:" + "1" * 64


def _scope_bundle() -> tuple[
    BackboneDiffRootScope,
    BackboneDiffBranchScope,
    BackboneDiffRowRef,
    BackboneDiffCellScope,
]:
    filters = BackboneDiffFilters(
        classification=("added", "changed"),
        category_code=None,
        parameter_code=None,
        include_unchanged=True,
    )
    root_scope = BackboneDiffRootScope(project_id=7, basis_hash=_VALID_BASIS_HASH, filters=filters)
    branch_scope = BackboneDiffBranchScope(
        project_id=7,
        layer_key="L1::PROC_A::010::ACT",
        basis_hash=_VALID_BASIS_HASH,
        filters=filters,
    )
    row_ref = BackboneDiffRowRef(
        project_id=7,
        layer_key="L1::PROC_A::010::ACT",
        row_status="matched",
        baseline_condition_id=101,
        current_condition_id=201,
    )
    cell_scope = BackboneDiffCellScope(
        project_id=7,
        layer_key="L1::PROC_A::010::ACT",
        basis_hash=_VALID_BASIS_HASH,
        row_ref=row_ref,
        filters=filters,
    )
    return root_scope, branch_scope, row_ref, cell_scope


async def _seed_project(db_session: AsyncSession) -> Project:
    photo = ParameterCategory(code="photo", display_name="Photo", sort_order=1)
    db_session.add_all(
        [
            Parameter(
                code="alpha",
                display_name="Alpha",
                value_type=ValueType.TEXT,
                sort_order=1,
                category=photo,
                is_active=True,
            ),
            Parameter(
                code="beta",
                display_name="Beta",
                value_type=ValueType.NUMBER,
                sort_order=2,
                category=photo,
                is_active=True,
            ),
            Parameter(
                code="gamma",
                display_name="Gamma",
                value_type=ValueType.TEXT,
                sort_order=3,
                category=photo,
                is_active=True,
            ),
            Parameter(
                code="legacy",
                display_name="Legacy",
                value_type=ValueType.TEXT,
                sort_order=4,
                category=photo,
                is_active=False,
            ),
        ]
    )

    project = Project(
        line_id="L1",
        process_id="PROC_A",
        part_id="PART_A",
        name="Project A",
        profile=make_project_profile(process_name="PROC_A"),
    )
    layer = SheetLayer(
        layer_key="L1::PROC_A::010::ACT",
        step_seq="010",
        layer_id="ACT",
        eqp_type="ACT",
        eqp_type_desc="Active",
        area_name="PHOTO",
        sort_order=1,
        source_project_id=1,
        source_layer_key="L1::PROC_A::010::ACT",
        backbone_snapshot=serialize_backbone_snapshot(
            BackboneSnapshot(
                capture_batch_id="0123456789abcdef0123456789abcdef",
                source=BackboneSnapshotSource(
                    project_id=1,
                    sheet_layer_id=11,
                    layer_key="L1::PROC_A::010::ACT",
                    step_seq="010",
                    layer_id="ACT",
                ),
                columns=(
                    BackboneSnapshotColumn(
                        parameter_code="alpha",
                        value_type=ValueType.TEXT,
                        display_name="Alpha",
                        category_code="photo",
                        sort_order=1,
                        active_at_capture=True,
                    ),
                    BackboneSnapshotColumn(
                        parameter_code="beta",
                        value_type=ValueType.NUMBER,
                        display_name="Beta",
                        category_code="photo",
                        sort_order=2,
                        active_at_capture=True,
                    ),
                ),
                conditions=(
                    BackboneSnapshotCondition(
                        source_condition_id=101,
                        label="base",
                        condition_index=0,
                        is_por=True,
                        cells=(
                            BackboneSnapshotCell(parameter_code="alpha", value="old"),
                            BackboneSnapshotCell(parameter_code="beta", value="1.00"),
                        ),
                    ),
                ),
            )
        ),
    )
    current = LayerCondition(
        label="base",
        condition_index=0,
        is_por=True,
        source_condition_id=101,
    )
    current.cell_values.extend(
        [
            CellValue(parameter_code="alpha", value_text="new"),
            CellValue(parameter_code="beta", value_text="2.00"),
            CellValue(parameter_code="legacy", value_text="legacy"),
        ]
    )
    added = LayerCondition(label="added", condition_index=1, is_por=False)
    added.cell_values.extend(
        [
            CellValue(parameter_code="alpha", value_text="added"),
            CellValue(parameter_code="gamma", value_text="fresh"),
        ]
    )
    layer.conditions.extend([current, added])
    project.layers.append(layer)
    db_session.add(project)
    await db_session.commit()
    return project


async def _seed_rich_project(db_session: AsyncSession) -> Project:
    photo = ParameterCategory(code="photo", display_name="Photo", sort_order=1)
    db_session.add_all(
        [
            Parameter(
                code="alpha",
                display_name="Alpha",
                value_type=ValueType.TEXT,
                sort_order=1,
                category=photo,
                is_active=True,
            ),
            Parameter(
                code="beta",
                display_name="Beta",
                value_type=ValueType.NUMBER,
                sort_order=2,
                category=photo,
                is_active=True,
            ),
            Parameter(
                code="gamma",
                display_name="Gamma",
                value_type=ValueType.TEXT,
                sort_order=3,
                category=photo,
                is_active=True,
            ),
            Parameter(
                code="legacy",
                display_name="Legacy",
                value_type=ValueType.TEXT,
                sort_order=4,
                category=photo,
                is_active=False,
            ),
        ]
    )

    project = Project(
        line_id="L1",
        process_id="PROC_A",
        part_id="PART_A",
        name="Project A",
        profile=make_project_profile(process_name="PROC_A"),
    )

    def _seed_layer(
        *,
        layer_key: str,
        step_seq: str,
        layer_id: str,
        sort_order: int,
        sheet_layer_id: int,
        matched_baseline_id: int,
        removed_baseline_id: int | None,
        baseline_label: str,
        current_label: str,
        removed_label: str | None,
        added_label: str | None,
        baseline_unavailable: bool = False,
    ) -> SheetLayer:
        layer = SheetLayer(
            layer_key=layer_key,
            step_seq=step_seq,
            layer_id=layer_id,
            eqp_type=layer_id,
            eqp_type_desc=f"{layer_id} description",
            area_name="PHOTO",
            sort_order=sort_order,
            source_project_id=1,
            source_layer_key=layer_key,
            backbone_snapshot=(
                None
                if baseline_unavailable
                else serialize_backbone_snapshot(
                    BackboneSnapshot(
                        capture_batch_id=f"0123456789abcdef0123456789abc{sort_order:03d}",
                        source=BackboneSnapshotSource(
                            project_id=1,
                            sheet_layer_id=sheet_layer_id,
                            layer_key=layer_key,
                            step_seq=step_seq,
                            layer_id=layer_id,
                        ),
                        columns=(
                            BackboneSnapshotColumn(
                                parameter_code="alpha",
                                value_type=ValueType.TEXT,
                                display_name="Alpha",
                                category_code="photo",
                                sort_order=1,
                                active_at_capture=True,
                            ),
                            BackboneSnapshotColumn(
                                parameter_code="beta",
                                value_type=ValueType.NUMBER,
                                display_name="Beta",
                                category_code="photo",
                                sort_order=2,
                                active_at_capture=True,
                            ),
                        ),
                        conditions=(
                            BackboneSnapshotCondition(
                                source_condition_id=matched_baseline_id,
                                label=baseline_label,
                                condition_index=0,
                                is_por=True,
                                cells=(
                                    BackboneSnapshotCell(parameter_code="alpha", value="old"),
                                    BackboneSnapshotCell(parameter_code="beta", value="1.00"),
                                ),
                            ),
                            BackboneSnapshotCondition(
                                source_condition_id=(
                                    removed_baseline_id
                                    if removed_baseline_id is not None
                                    else matched_baseline_id + 1
                                ),
                                label=removed_label or "removed",
                                condition_index=1,
                                is_por=False,
                                cells=(
                                    BackboneSnapshotCell(parameter_code="alpha", value="gone"),
                                    BackboneSnapshotCell(parameter_code="beta", value="2.00"),
                                ),
                            ),
                        ),
                    )
                )
            ),
        )
        current_matched = LayerCondition(
            label=current_label,
            condition_index=0,
            is_por=True,
            source_condition_id=matched_baseline_id,
        )
        current_matched.cell_values.extend(
            [
                CellValue(parameter_code="alpha", value_text="new"),
                CellValue(parameter_code="beta", value_text="1.00"),
                CellValue(parameter_code="legacy", value_text="legacy"),
            ]
        )
        added = LayerCondition(
            label=added_label or "added",
            condition_index=1,
            is_por=False,
        )
        added.cell_values.extend(
            [
                CellValue(parameter_code="alpha", value_text="added"),
                CellValue(parameter_code="gamma", value_text="fresh"),
            ]
        )
        if baseline_unavailable:
            layer.conditions.append(current_matched)
        else:
            layer.conditions.extend([current_matched, added])
        return layer

    layer_a = _seed_layer(
        layer_key="L1::PROC_A::010::ACT",
        step_seq="010",
        layer_id="ACT",
        sort_order=1,
        sheet_layer_id=11,
        matched_baseline_id=101,
        removed_baseline_id=102,
        baseline_label="base",
        current_label="base current",
        removed_label="removed",
        added_label="added",
    )
    layer_b = _seed_layer(
        layer_key="L1::PROC_A::020::ACT",
        step_seq="020",
        layer_id="ACT",
        sort_order=2,
        sheet_layer_id=12,
        matched_baseline_id=301,
        removed_baseline_id=302,
        baseline_label="base b",
        current_label="base current b",
        removed_label="removed b",
        added_label="added b",
    )
    layer_c = _seed_layer(
        layer_key="L1::PROC_A::030::ACT",
        step_seq="030",
        layer_id="ACT",
        sort_order=3,
        sheet_layer_id=13,
        matched_baseline_id=501,
        removed_baseline_id=None,
        baseline_label="unused",
        current_label="solo current",
        removed_label=None,
        added_label=None,
        baseline_unavailable=True,
    )
    project.layers.extend([layer_a, layer_b, layer_c])
    db_session.add(project)
    await db_session.commit()
    return project


async def _seed_dense_value_project(
    db_session: AsyncSession,
    *,
    parameter_count: int,
    value_length: int,
) -> Project:
    photo = ParameterCategory(code="photo", display_name="Photo", sort_order=1)
    columns: list[BackboneSnapshotColumn] = []
    baseline_cells: list[BackboneSnapshotCell] = []
    current_cells: list[CellValue] = []
    parameters = []
    for index in range(parameter_count):
        code = f"p{index:03d}"
        parameters.append(
            Parameter(
                code=code,
                display_name=f"Param {index:03d}",
                value_type=ValueType.TEXT,
                sort_order=index + 1,
                category=photo,
                is_active=True,
            )
        )
        columns.append(
            BackboneSnapshotColumn(
                parameter_code=code,
                value_type=ValueType.TEXT,
                display_name=f"Param {index:03d}",
                category_code="photo",
                sort_order=index + 1,
                active_at_capture=True,
            )
        )
        baseline_cells.append(BackboneSnapshotCell(parameter_code=code, value="baseline"))
        current_cells.append(CellValue(parameter_code=code, value_text=("x" * value_length)))
    db_session.add_all(parameters)

    project = Project(
        line_id="L1",
        process_id="PROC_A",
        part_id="PART_A",
        name="Project Dense",
        profile=make_project_profile(process_name="PROC_A"),
    )
    layer = SheetLayer(
        layer_key="L1::PROC_A::010::ACT",
        step_seq="010",
        layer_id="ACT",
        eqp_type="ACT",
        eqp_type_desc="Active",
        area_name="PHOTO",
        sort_order=1,
        source_project_id=1,
        source_layer_key="L1::PROC_A::010::ACT",
        backbone_snapshot=serialize_backbone_snapshot(
            BackboneSnapshot(
                capture_batch_id="0123456789abcdef0123456789abcdef",
                source=BackboneSnapshotSource(
                    project_id=1,
                    sheet_layer_id=11,
                    layer_key="L1::PROC_A::010::ACT",
                    step_seq="010",
                    layer_id="ACT",
                ),
                columns=tuple(columns),
                conditions=(
                    BackboneSnapshotCondition(
                        source_condition_id=101,
                        label="base",
                        condition_index=0,
                        is_por=True,
                        cells=tuple(baseline_cells),
                    ),
                ),
            )
        ),
    )
    current = LayerCondition(
        label="base",
        condition_index=0,
        is_por=True,
        source_condition_id=101,
    )
    current.cell_values.extend(current_cells)
    layer.conditions.append(current)
    project.layers.append(layer)
    db_session.add(project)
    await db_session.commit()
    return project


def _preview_identity(item: dict[str, Any]) -> int:
    row_ref = decode_backbone_diff_row_ref(item["row_ref"])
    return row_ref.current_condition_id or row_ref.baseline_condition_id or 0


def _root_preview_sort_key(
    item: dict[str, Any], layer_sort_by_key: dict[str, int]
) -> tuple[Any, ...]:
    return (
        layer_sort_by_key[item["layer_key"]],
        item["layer_key"],
        item["effective_condition_index"],
        item["status_rank"],
        _preview_identity(item),
        0 if item["item_kind"] == "row" else 1,
        tuple(item["item_sort_key"]),
    )


def _branch_sort_key(item: dict[str, Any]) -> tuple[int, int, int]:
    return (
        item["effective_condition_index"],
        {"matched": 0, "added": 1, "removed": 2}[item["row_status"]],
        item["identity"],
    )


def _cell_sort_key(item: dict[str, Any]) -> tuple[int, str]:
    return (item["parameter_sort"], item["parameter_code"])


def _rich_layer_preview_sorted(
    items: list[dict[str, Any]], layer_sort_by_key: dict[str, int]
) -> list[dict[str, Any]]:
    return sorted(items, key=lambda item: _root_preview_sort_key(item, layer_sort_by_key))


def _decode_token_payload(token: str) -> dict[str, Any]:
    padding = "=" * (-len(token) % 4)
    raw = base64.urlsafe_b64decode(token + padding)
    return json.loads(raw)


def _encode_token_payload(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _encode_noncanonical_token(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, indent=2, ensure_ascii=False).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _valid_baseline_snapshot(
    *,
    source_project_id: int,
    sheet_layer_id: int,
    layer_key: str,
    capture_batch_id: str,
    columns: tuple[BackboneSnapshotColumn, ...],
    conditions: tuple[BackboneSnapshotCondition, ...],
    captured_at: datetime | str | None = None,
    source: BackboneSnapshotSource | None = None,
) -> BackboneSnapshot:
    snapshot = object.__new__(BackboneSnapshot)
    object.__setattr__(snapshot, "schema_version", 1)
    object.__setattr__(snapshot, "capture_batch_id", capture_batch_id)
    object.__setattr__(snapshot, "captured_at", captured_at or datetime.now(UTC))
    object.__setattr__(
        snapshot,
        "source",
        source
        or BackboneSnapshotSource(
            project_id=source_project_id,
            sheet_layer_id=sheet_layer_id,
            layer_key=layer_key,
            step_seq="010",
            layer_id="ACT",
        ),
    )
    object.__setattr__(snapshot, "columns", columns)
    object.__setattr__(snapshot, "conditions", conditions)
    return snapshot


async def _assert_provider_conflict(
    provider: BackboneDiffProvider,
    monkeypatch: pytest.MonkeyPatch,
    project_input: BackboneDiffProjectInput,
    expected_code: str,
) -> None:
    async def _load_input(project_id: int) -> BackboneDiffProjectInput:
        assert project_id == project_input.project_id
        return project_input

    monkeypatch.setattr(provider, "_load_input", _load_input)
    with pytest.raises(ConflictError) as excinfo:
        await provider.load_root(project_input.project_id, BackboneDiffRootQueryIn())
    assert excinfo.value.code == expected_code


@pytest.mark.asyncio
async def test_backbone_diff_tokens_round_trip() -> None:
    root_scope, branch_scope, row_ref, cell_scope = _scope_bundle()

    assert decode_backbone_diff_scope(encode_backbone_diff_scope(root_scope)) == root_scope
    assert decode_backbone_diff_scope(encode_backbone_diff_scope(branch_scope)) == branch_scope
    assert decode_backbone_diff_scope(encode_backbone_diff_scope(cell_scope)) == cell_scope
    assert decode_backbone_diff_row_ref(encode_backbone_diff_row_ref(row_ref)) == row_ref

    cursor = BackboneDiffCursor(
        version=1,
        kind="branch",
        scope=branch_scope,
        sort_key=(1, 1, 201),
    )
    assert decode_backbone_diff_cursor(encode_backbone_diff_cursor(cursor)) == cursor


@pytest.mark.parametrize("classification", [0, False, "", None, {"added": True}])
def test_backbone_diff_decode_rejects_falsey_classification_values(classification: Any) -> None:
    _root_scope, branch_scope, _row_ref, _cell_scope = _scope_bundle()
    payload = _decode_token_payload(encode_backbone_diff_scope(branch_scope))
    payload["filters"]["classification"] = classification

    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_scope(_encode_token_payload(payload))

    assert excinfo.value.code == "invalid_scope"


def test_backbone_diff_cursor_binds_kind_to_matching_scope_class() -> None:
    root_scope, branch_scope, _row_ref, cell_scope = _scope_bundle()

    with pytest.raises(RuleViolationError) as excinfo:
        BackboneDiffCursor(version=1, kind="branch", scope=root_scope, sort_key=(1, 1, 1))
    assert excinfo.value.code == "invalid_cursor"

    with pytest.raises(RuleViolationError) as excinfo:
        BackboneDiffCursor(version=1, kind="cell", scope=branch_scope, sort_key=(1, "alpha"))
    assert excinfo.value.code == "invalid_cursor"

    with pytest.raises(RuleViolationError) as excinfo:
        BackboneDiffCursor(version=1, kind="root", scope=cell_scope, sort_key=())
    assert excinfo.value.code == "invalid_cursor"


def test_backbone_diff_nested_cursor_probes_emit_invalid_cursor() -> None:
    _root_scope, branch_scope, _row_ref, cell_scope = _scope_bundle()

    cursor_bad_filter_payload = _decode_token_payload(
        encode_backbone_diff_cursor(
            BackboneDiffCursor(version=1, kind="branch", scope=branch_scope, sort_key=(1, 1, 1))
        )
    )
    cursor_bad_filter_payload["scope"]["filters"]["classification"] = 0
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_cursor(_encode_token_payload(cursor_bad_filter_payload))
    print("cursor_bad_filter", excinfo.value.code)
    assert excinfo.value.code == "invalid_cursor"

    cursor_filter_cross_invariant_payload = _decode_token_payload(
        encode_backbone_diff_cursor(
            BackboneDiffCursor(version=1, kind="branch", scope=branch_scope, sort_key=(1, 1, 1))
        )
    )
    cursor_filter_cross_invariant_payload["scope"]["filters"]["classification"] = ["unchanged"]
    cursor_filter_cross_invariant_payload["scope"]["filters"]["include_unchanged"] = False
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_cursor(_encode_token_payload(cursor_filter_cross_invariant_payload))
    print("cursor_filter_cross_invariant", excinfo.value.code)
    assert excinfo.value.code == "invalid_cursor"

    cursor_bad_row_shape_payload = _decode_token_payload(
        encode_backbone_diff_cursor(
            BackboneDiffCursor(version=1, kind="cell", scope=cell_scope, sort_key=(1, "beta"))
        )
    )
    cursor_bad_row_shape_payload["scope"]["row_ref"]["project_id"] = 0
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_cursor(_encode_token_payload(cursor_bad_row_shape_payload))
    print("cursor_bad_row_shape", excinfo.value.code)
    assert excinfo.value.code == "invalid_cursor"

    cursor_bad_row_shape_matched_payload = _decode_token_payload(
        encode_backbone_diff_cursor(
            BackboneDiffCursor(version=1, kind="cell", scope=cell_scope, sort_key=(1, "beta"))
        )
    )
    cursor_bad_row_shape_matched_payload["scope"]["row_ref"]["current_condition_id"] = None
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_cursor(_encode_token_payload(cursor_bad_row_shape_matched_payload))
    assert excinfo.value.code == "invalid_cursor"

    cursor_row_project_binding_payload = _decode_token_payload(
        encode_backbone_diff_cursor(
            BackboneDiffCursor(version=1, kind="cell", scope=cell_scope, sort_key=(1, "beta"))
        )
    )
    cursor_row_project_binding_payload["scope"]["row_ref"]["project_id"] = 999
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_cursor(_encode_token_payload(cursor_row_project_binding_payload))
    print("cursor_row_project_binding", excinfo.value.code)
    assert excinfo.value.code == "invalid_cursor"

    cursor_row_layer_binding_payload = _decode_token_payload(
        encode_backbone_diff_cursor(
            BackboneDiffCursor(version=1, kind="cell", scope=cell_scope, sort_key=(1, "beta"))
        )
    )
    cursor_row_layer_binding_payload["scope"]["row_ref"]["layer_key"] = "other-layer"
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_cursor(_encode_token_payload(cursor_row_layer_binding_payload))
    print("cursor_row_layer_binding", excinfo.value.code)
    assert excinfo.value.code == "invalid_cursor"


def test_backbone_diff_nested_scope_probes_emit_invalid_scope() -> None:
    _root_scope, branch_scope, _row_ref, cell_scope = _scope_bundle()

    scope_filter_cross_invariant_payload = _decode_token_payload(
        encode_backbone_diff_scope(branch_scope)
    )
    scope_filter_cross_invariant_payload["filters"]["classification"] = ["unchanged"]
    scope_filter_cross_invariant_payload["filters"]["include_unchanged"] = False
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_scope(_encode_token_payload(scope_filter_cross_invariant_payload))
    assert excinfo.value.code == "invalid_scope"

    scope_row_project_binding_payload = _decode_token_payload(
        encode_backbone_diff_scope(cell_scope)
    )
    scope_row_project_binding_payload["row_ref"]["project_id"] = 999
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_scope(_encode_token_payload(scope_row_project_binding_payload))
    assert excinfo.value.code == "invalid_scope"

    scope_row_layer_binding_payload = _decode_token_payload(
        encode_backbone_diff_scope(cell_scope)
    )
    scope_row_layer_binding_payload["row_ref"]["layer_key"] = "other-layer"
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_scope(_encode_token_payload(scope_row_layer_binding_payload))
    assert excinfo.value.code == "invalid_scope"


def test_backbone_diff_preview_candidates_sort_metadata_lexically() -> None:
    provider = object.__new__(BackboneDiffProvider)
    row = BackboneDiffRow(
        layer_key="L1::PROC_A::010::ACT",
        row_status="matched",
        effective_condition_index=0,
        identity=1,
        baseline_source_condition_id=101,
        current_id=201,
        baseline_condition_index=0,
        current_condition_index=0,
        baseline_label="base",
        current_label="current",
        baseline_is_por=True,
        current_is_por=True,
        metadata_changes=(
            BackboneDiffMetadataChange(
                field_name="label",
                baseline_value="base",
                current_value="current",
            ),
            BackboneDiffMetadataChange(
                field_name="is_por",
                baseline_value=True,
                current_value=False,
            ),
            BackboneDiffMetadataChange(
                field_name="condition_index", baseline_value=0, current_value=1
            ),
        ),
        cell_changes=(
            BackboneDiffCellChange(
                parameter_code="beta",
                sort_order=2,
                classification="changed",
                reason="value_changed",
                baseline_value="1.00",
                current_value="2.00",
            ),
        ),
    )
    candidates = provider._row_preview_candidates(row)
    assert [candidate[2][0] for candidate in candidates[:3]] == [
        "condition_index",
        "is_por",
        "label",
    ]


def test_backbone_diff_provider_uses_selected_current_metadata_and_added_row_baseline_absent(
) -> None:
    provider = object.__new__(BackboneDiffProvider)
    bundle = _LayerBundle(
        project_id=7,
        result=object(),  # type: ignore[arg-type]
        input=object(),  # type: ignore[arg-type]
        current_source_condition_ids={201: 101},
        selected_current_parameters_by_code={
            "alpha": BackboneDiffCurrentParameter(
                code="alpha",
                value_type=ValueType.TEXT,
                display_name="Alpha current",
                category_code="photo",
                sort_order=7,
                active=True,
            ),
        },
        baseline_columns_by_code={
            "legacy": BackboneSnapshotColumn(
                parameter_code="legacy",
                value_type=ValueType.TEXT,
                display_name="Legacy frozen",
                category_code="photo",
                sort_order=4,
                active_at_capture=False,
            )
        },
    )
    baseline_row = BackboneDiffRow(
        layer_key="L1::PROC_A::010::ACT",
        row_status="matched",
        effective_condition_index=0,
        identity=1,
        baseline_source_condition_id=101,
        current_id=201,
        baseline_condition_index=0,
        current_condition_index=0,
        baseline_label="base",
        current_label="current",
        baseline_is_por=True,
        current_is_por=True,
        cell_changes=(),
    )
    added_row = replace(
        baseline_row,
        row_status="added",
        baseline_source_condition_id=999,
        current_id=202,
    )

    baseline_metadata = provider._parameter_metadata(
        bundle, "legacy", baseline=True, row_status=baseline_row.row_status
    )
    current_metadata = provider._parameter_metadata(
        bundle, "legacy", baseline=False, row_status=baseline_row.row_status
    )
    assert baseline_metadata is not None
    assert baseline_metadata.display_name == "Legacy frozen"
    assert baseline_metadata.sort_order == 4
    assert baseline_metadata.category_code == "photo"
    assert current_metadata is None
    assert provider._baseline_condition_metadata(added_row) is None


@pytest.mark.asyncio
async def test_backbone_diff_root_branch_and_cell_routes_use_the_real_provider(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project = await _seed_project(db_session)

    root = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params=[
            ("classification", "changed"),
            ("classification", "added"),
            ("include_unchanged", "true"),
            ("preview_limit", "5"),
        ],
    )
    assert root.status_code == 200, root.text
    root_body = root.json()
    assert root_body["basis_hash"].startswith("sha256:")
    assert root_body["counts"]["layer_count"] == 1
    assert root_body["counts"]["full_row_count"] >= root_body["counts"]["row_count"]
    assert root_body["counts"]["full_cell_count"] >= root_body["counts"]["cell_count"]
    assert root_body["layer_summaries"][0]["branch_scope"] is not None
    assert root_body["changed_preview"]

    branch_scope = root_body["layer_summaries"][0]["branch_scope"]
    branch = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope, "limit": 10},
    )
    assert branch.status_code == 200, branch.text
    branch_body = branch.json()
    assert branch_body["basis_hash"] == root_body["basis_hash"]
    assert branch_body["items"]

    row_ref = branch_body["items"][0]["row_ref"]
    cell_scope = branch_body["items"][0]["cell_scope"]
    assert decode_backbone_diff_scope(cell_scope).basis_hash == root_body["basis_hash"]
    cells = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions/{row_ref}/cells",
        params={"scope": cell_scope, "limit": 10},
    )
    assert cells.status_code == 200, cells.text
    cells_body = cells.json()
    assert cells_body["basis_hash"] == root_body["basis_hash"]
    assert cells_body["items"]


@pytest.mark.asyncio
async def test_backbone_diff_summary_logging_is_scrubbed_on_success(
    db_client: AsyncClient,
    db_session: AsyncSession,
    caplog: pytest.LogCaptureFixture,
) -> None:
    project = await _seed_project(db_session)
    caplog.set_level("INFO")
    response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={"include_unchanged": "true", "preview_limit": "5"},
    )
    assert response.status_code == 200, response.text
    summary_records = [
        record for record in caplog.records if record.message == "backbone_diff_request_summary"
    ]
    assert len(summary_records) == 1
    record = cast(Any, summary_records[0])
    assert record.operation == "root"
    assert record.route == "root"
    assert record.project_id == project.id
    assert record.status == 200
    assert record.count == len(response.json()["changed_preview"])
    assert record.layer_count >= 1
    assert record.row_count >= 0
    assert record.cell_count >= 0
    assert record.load_ms >= 0
    assert record.query_ms >= 0
    assert record.compute_ms >= 0
    banned_fields = {
        "scope",
        "cursor",
        "row_ref",
        "raw_value",
        "payload",
        "profile",
        "auth",
        "lock_token",
        "exception",
    }
    assert all(field not in record.__dict__ for field in banned_fields)


@pytest.mark.asyncio
async def test_backbone_diff_summary_logging_is_scrubbed_on_failure(
    db_client: AsyncClient,
    db_session: AsyncSession,
    caplog: pytest.LogCaptureFixture,
) -> None:
    project = await _seed_project(db_session)
    root = await db_client.get(f"/api/projects/{project.id}/backbone-diff")
    branch_scope = root.json()["layer_summaries"][0]["branch_scope"]
    project.layers[0].conditions[0].label = "mutated"
    await db_session.commit()

    caplog.set_level("INFO")
    response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope},
    )
    assert response.status_code == 409, response.text
    summary_records = [
        record for record in caplog.records if record.message == "backbone_diff_request_summary"
    ]
    assert len(summary_records) == 1
    record = cast(Any, summary_records[0])
    assert record.operation == "conditions"
    assert record.route == "conditions"
    assert record.project_id == project.id
    assert record.status == 409
    assert record.count == 0
    banned_fields = {
        "scope",
        "cursor",
        "row_ref",
        "raw_value",
        "payload",
        "profile",
        "auth",
        "lock_token",
        "exception",
    }
    assert all(field not in record.__dict__ for field in banned_fields)


@pytest.mark.asyncio
async def test_backbone_diff_root_preview_ordering_counts_and_filter_boundaries(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project = await _seed_rich_project(db_session)

    root = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={"include_unchanged": "true", "preview_limit": "20"},
    )
    assert root.status_code == 200, root.text
    root_body = root.json()
    layer_sort_by_key = {
        summary["layer_key"]: summary["layer_sort"] for summary in root_body["layer_summaries"]
    }
    assert root_body["counts"]["layer_count"] == 3
    assert root_body["counts"]["available_layer_count"] == 2
    assert root_body["counts"]["unavailable_layer_count"] == 1
    assert root_body["counts"]["full_row_count"] == sum(
        summary["full_row_count"] for summary in root_body["layer_summaries"]
    )
    assert root_body["counts"]["full_cell_count"] == sum(
        summary["full_cell_count"] for summary in root_body["layer_summaries"]
    )
    assert root_body["counts"]["row_count"] == sum(
        summary["row_count"] for summary in root_body["layer_summaries"]
    )
    assert root_body["counts"]["cell_count"] == sum(
        summary["cell_count"] for summary in root_body["layer_summaries"]
    )
    assert root_body["changed_preview"] == _rich_layer_preview_sorted(
        root_body["changed_preview"], layer_sort_by_key
    )
    assert any(item["item_kind"] == "row" for item in root_body["changed_preview"])
    assert any(item["classification"] == "unchanged" for item in root_body["changed_preview"])
    assert root_body["layer_summaries"][2]["branch_scope"] is None
    assert root_body["layer_summaries"][2]["layer_status"] == "unavailable"
    assert root_body["layer_summaries"][2]["baseline_condition_count"] == 0
    root_scope = decode_backbone_diff_scope(root_body["scope"])
    assert root_scope.project_id == project.id
    assert root_scope.filters.include_unchanged is True

    default_root = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={"preview_limit": "20"},
    )
    assert default_root.status_code == 200, default_root.text
    assert all(
        item["classification"] != "unchanged" for item in default_root.json()["changed_preview"]
    )
    preview_limited_root = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={"include_unchanged": "true", "preview_limit": "1"},
    )
    assert preview_limited_root.status_code == 200, preview_limited_root.text
    assert preview_limited_root.json()["counts"] == root_body["counts"]
    assert preview_limited_root.json()["layer_summaries"] == root_body["layer_summaries"]

    category_root = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={"include_unchanged": "true", "category_code": "photo", "preview_limit": "20"},
    )
    assert category_root.status_code == 200, category_root.text
    assert all(item["item_kind"] == "cell" for item in category_root.json()["changed_preview"])

    parameter_root = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={
            "include_unchanged": "true",
            "parameter_code": "alpha",
            "preview_limit": "20",
        },
    )
    assert parameter_root.status_code == 200, parameter_root.text
    assert all(item["item_kind"] == "cell" for item in parameter_root.json()["changed_preview"])


@pytest.mark.asyncio
async def test_backbone_diff_root_layer_filter_limits_summaries_to_visible_layer(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project = await _seed_rich_project(db_session)
    response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={
            "include_unchanged": "true",
            "preview_limit": "20",
            "layer_key": "L1::PROC_A::020::ACT",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["counts"]["layer_count"] == 3
    assert len(body["layer_summaries"]) == 1
    assert body["layer_summaries"][0]["layer_key"] == "L1::PROC_A::020::ACT"
    assert body["layer_summaries"][0]["branch_scope"] is not None
    assert all(item["layer_key"] == "L1::PROC_A::020::ACT" for item in body["changed_preview"])


@pytest.mark.asyncio
async def test_backbone_diff_root_rejects_unchanged_without_include_flag(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project = await _seed_project(db_session)
    response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={"classification": "unchanged"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [1, 100, 101])
async def test_backbone_diff_branch_limit_boundaries(
    db_client: AsyncClient,
    db_session: AsyncSession,
    limit: int,
) -> None:
    project = await _seed_rich_project(db_session)
    root = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={"include_unchanged": "true", "preview_limit": "20"},
    )
    branch_scope = root.json()["layer_summaries"][0]["branch_scope"]
    response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope, "limit": limit},
    )
    assert response.status_code == (200 if limit <= 100 else 422), response.text
    if response.status_code == 200:
        assert len(response.json()["items"]) <= limit


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [1, 200, 201])
async def test_backbone_diff_cell_limit_boundaries(
    db_client: AsyncClient,
    db_session: AsyncSession,
    limit: int,
) -> None:
    project = await _seed_rich_project(db_session)
    root = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={"include_unchanged": "true", "preview_limit": "20"},
    )
    branch_scope = root.json()["layer_summaries"][0]["branch_scope"]
    branch = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope, "limit": 20},
    )
    row_ref = branch.json()["items"][0]["row_ref"]
    cell_scope = branch.json()["items"][0]["cell_scope"]
    response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions/{row_ref}/cells",
        params={"scope": cell_scope, "limit": limit},
    )
    assert response.status_code == (200 if limit <= 200 else 422), response.text
    if response.status_code == 200:
        assert len(response.json()["items"]) <= limit


@pytest.mark.asyncio
async def test_backbone_diff_cell_response_stays_within_byte_budget(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project = await _seed_dense_value_project(db_session, parameter_count=100, value_length=4096)
    root = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={"preview_limit": "20"},
    )
    assert root.status_code == 200, root.text
    branch_scope = root.json()["layer_summaries"][0]["branch_scope"]
    branch = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope, "limit": 100},
    )
    assert branch.status_code == 200, branch.text
    row_ref = branch.json()["items"][0]["row_ref"]
    cell_scope = branch.json()["items"][0]["cell_scope"]
    response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions/{row_ref}/cells",
        params={"scope": cell_scope, "limit": 100},
    )
    assert response.status_code == 200, response.text
    assert len(response.content) <= 256 * 1024
    body = response.json()
    assert body["next_cursor"] is not None
    assert len(body["items"]) < 100


@pytest.mark.asyncio
async def test_backbone_diff_cell_value_over_public_contract_returns_409(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project = await _seed_dense_value_project(db_session, parameter_count=3, value_length=5000)
    root = await db_client.get(f"/api/projects/{project.id}/backbone-diff")
    assert root.status_code == 200, root.text
    branch_scope = root.json()["layer_summaries"][0]["branch_scope"]
    branch = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope, "limit": 10},
    )
    assert branch.status_code == 409, branch.text
    assert branch.json()["code"] == "value_too_long"


def test_backbone_diff_decode_rejects_extra_missing_and_wrong_type_token_keys() -> None:
    _root_scope, branch_scope, row_ref, cell_scope = _scope_bundle()

    bad_branch_payload = _decode_token_payload(encode_backbone_diff_scope(branch_scope))
    bad_branch_payload.pop("layer_key")
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_scope(_encode_token_payload(bad_branch_payload))
    assert excinfo.value.code == "invalid_scope"

    bad_scope_payload = _decode_token_payload(encode_backbone_diff_scope(cell_scope))
    bad_scope_payload["extra"] = "nope"
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_scope(_encode_token_payload(bad_scope_payload))
    assert excinfo.value.code == "invalid_scope"

    bad_row_payload = _decode_token_payload(encode_backbone_diff_row_ref(row_ref))
    bad_row_payload["project_id"] = 0
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_row_ref(_encode_token_payload(bad_row_payload))
    assert excinfo.value.code == "invalid_row_ref"

    bad_cursor_payload = _decode_token_payload(
        encode_backbone_diff_cursor(
            BackboneDiffCursor(version=1, kind="branch", scope=branch_scope, sort_key=(1, 1, 1))
        )
    )
    bad_cursor_payload["sort_key"] = [1, 0]
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_cursor(_encode_token_payload(bad_cursor_payload))
    assert excinfo.value.code == "invalid_cursor"

    canonical_scope_payload = _decode_token_payload(encode_backbone_diff_scope(branch_scope))
    canonical_scope_payload["filters"]["classification"] = {"changed": True}
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_scope(_encode_token_payload(canonical_scope_payload))
    assert excinfo.value.code == "invalid_scope"

    noncanonical_cursor_payload = _decode_token_payload(
        encode_backbone_diff_cursor(
            BackboneDiffCursor(version=1, kind="branch", scope=branch_scope, sort_key=(1, 1, 1))
        )
    )
    with pytest.raises(RuleViolationError) as excinfo:
        decode_backbone_diff_cursor(_encode_noncanonical_token(noncanonical_cursor_payload))
    assert excinfo.value.code == "invalid_cursor"


@pytest.mark.asyncio
async def test_backbone_diff_cell_scope_tamper_rejects_outer_scope_before_row_ref(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project = await _seed_project(db_session)
    root = await db_client.get(f"/api/projects/{project.id}/backbone-diff")
    branch_scope = root.json()["layer_summaries"][0]["branch_scope"]
    branch = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope},
    )
    row_ref = branch.json()["items"][0]["row_ref"]
    cell_scope = branch.json()["items"][0]["cell_scope"]
    bad_scope_payload = _decode_token_payload(cell_scope)
    bad_scope_payload["layer_key"] = "WRONG::LAYER"
    bad_scope = _encode_token_payload(bad_scope_payload)
    response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions/{row_ref}/cells",
        params={"scope": bad_scope},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_scope"


@pytest.mark.asyncio
async def test_backbone_diff_branch_and_cell_pagination_and_tamper_and_stale_scopes(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project = await _seed_rich_project(db_session)
    root = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={"include_unchanged": "true", "preview_limit": "20"},
    )
    root_body = root.json()
    branch_scope_a = root_body["layer_summaries"][0]["branch_scope"]
    branch_scope_b = root_body["layer_summaries"][1]["branch_scope"]

    branch_first = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope_a, "limit": 2},
    )
    assert branch_first.status_code == 200, branch_first.text
    branch_first_body = branch_first.json()
    assert branch_first_body["items"] == sorted(branch_first_body["items"], key=_branch_sort_key)
    assert branch_first_body["next_cursor"] is not None

    branch_second = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope_a, "limit": 2, "cursor": branch_first_body["next_cursor"]},
    )
    assert branch_second.status_code == 200, branch_second.text
    branch_second_body = branch_second.json()
    assert branch_second_body["items"] == sorted(branch_second_body["items"], key=_branch_sort_key)

    all_branch_items = branch_first_body["items"] + branch_second_body["items"]
    assert len({item["row_ref"] for item in all_branch_items}) == 3

    matched_row = next(item for item in all_branch_items if item["row_status"] == "matched")
    matched_row_ref = decode_backbone_diff_row_ref(matched_row["row_ref"])
    assert matched_row["current_condition"]["condition_id"] == matched_row_ref.current_condition_id
    assert matched_row["current_condition"]["source_condition_id"] == 101
    assert matched_row["baseline_condition"]["condition_id"] is None
    assert matched_row["baseline_condition"]["source_condition_id"] == 101
    assert matched_row["row_metadata"]["label_changed"] is True
    assert matched_row["row_metadata"]["index_changed"] is False
    assert matched_row["row_metadata"]["por_changed"] is False
    assert decode_backbone_diff_scope(matched_row["cell_scope"]).basis_hash == (
        decode_backbone_diff_scope(branch_scope_a).basis_hash
    )

    removed_row = next(item for item in all_branch_items if item["row_status"] == "removed")
    removed_cells = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions/{removed_row['row_ref']}/cells",
        params={"scope": removed_row["cell_scope"], "limit": 20},
    )
    assert removed_cells.status_code == 200, removed_cells.text
    removed_cells_body = removed_cells.json()
    assert all(cell["classification"] == "removed" for cell in removed_cells_body["items"])
    assert all(cell["current_value"] is None for cell in removed_cells_body["items"])

    cells_first = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions/{matched_row['row_ref']}/cells",
        params={"scope": matched_row["cell_scope"], "limit": 2},
    )
    assert cells_first.status_code == 200, cells_first.text
    cells_first_body = cells_first.json()
    assert cells_first_body["items"] == sorted(cells_first_body["items"], key=_cell_sort_key)
    assert cells_first_body["next_cursor"] is not None

    cells_second = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions/{matched_row['row_ref']}/cells",
        params={
            "scope": matched_row["cell_scope"],
            "limit": 2,
            "cursor": cells_first_body["next_cursor"],
        },
    )
    assert cells_second.status_code == 200, cells_second.text
    cells_second_body = cells_second.json()
    assert cells_second_body["items"] == sorted(cells_second_body["items"], key=_cell_sort_key)
    all_cells = cells_first_body["items"] + cells_second_body["items"]
    assert [cell["parameter_code"] for cell in all_cells] == [
        "alpha",
        "beta",
        "gamma",
        "legacy",
    ]
    assert len({cell["parameter_code"] for cell in all_cells}) == 4

    branch_cursor_tamper = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::020::ACT/conditions",
        params={"scope": branch_scope_b, "cursor": branch_first_body["next_cursor"]},
    )
    assert branch_cursor_tamper.status_code == 422
    assert branch_cursor_tamper.json()["code"] == "invalid_cursor"

    project.layers[0].conditions[0].label = "base mutated"
    await db_session.commit()

    stale_branch = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope_a, "limit": 2},
    )
    assert stale_branch.status_code == 409
    assert stale_branch.json()["code"] == "diff_basis_changed"

    stale_cells = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions/{matched_row['row_ref']}/cells",
        params={"scope": matched_row["cell_scope"], "limit": 2},
    )
    assert stale_cells.status_code == 409
    assert stale_cells.json()["code"] == "diff_basis_changed"

    fresh_root = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff",
        params={"include_unchanged": "true", "preview_limit": "20"},
    )
    assert fresh_root.status_code == 200, fresh_root.text
    assert fresh_root.json()["basis_hash"] != root_body["basis_hash"]


@pytest.mark.asyncio
async def test_backbone_diff_provider_maps_invalid_contracts_to_conflict(
    db_session_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = BackboneDiffProvider(db_session_factory)

    columns = (
        BackboneSnapshotColumn(
            parameter_code="alpha",
            value_type=ValueType.TEXT,
            display_name="Alpha",
            category_code="photo",
            sort_order=1,
            active_at_capture=True,
        ),
    )
    baseline_condition = BackboneSnapshotCondition(
        source_condition_id=101,
        label="base",
        condition_index=0,
        is_por=True,
        cells=(BackboneSnapshotCell(parameter_code="alpha", value="old"),),
    )
    current_parameter = BackboneDiffCurrentParameter(
        code="alpha",
        value_type=ValueType.TEXT,
        display_name="Alpha",
        category_code="photo",
        sort_order=1,
        active=True,
    )
    current_condition = BackboneDiffCurrentCondition(
        id=201,
        source_condition_id=101,
        label="base current",
        condition_index=0,
        is_por=True,
        cells=(BackboneDiffCurrentCell(parameter_code="alpha", value="new"),),
    )

    async def _invalid_backbone_input(project_id: int) -> BackboneDiffProjectInput:
        del project_id
        malformed = _valid_baseline_snapshot(
            source_project_id=7,
            sheet_layer_id=11,
            layer_key="L1::PROC_A::010::ACT",
            capture_batch_id="0123456789abcdef0123456789abcdef",
            columns=columns,
            conditions=(baseline_condition,),
            captured_at="broken",
            source=None,
        )
        layer = BackboneDiffLayerInput(
            layer_key="L1::PROC_A::010::ACT",
            layer_sort_order=1,
            current_source=BackboneDiffCurrentLayerSource(
                project_id=7,
                sheet_layer_id=11,
                layer_key="L1::PROC_A::010::ACT",
                step_seq="010",
                layer_id="ACT",
                sort_order=1,
                source_project_id=None,
                source_layer_key=None,
            ),
            baseline_snapshot=malformed,
            current_conditions=(current_condition,),
            current_parameters=(current_parameter,),
        )
        return BackboneDiffProjectInput(
            project_id=7,
            line_id="L1",
            process_id="PROC_A",
            part_id="PART_A",
            project_name="Project A",
            project_status="draft",
            captured_at=datetime.now(UTC),
            layers=(layer,),
        )

    async def _type_mismatch_input(project_id: int) -> BackboneDiffProjectInput:
        del project_id
        type_mismatch_snapshot = _valid_baseline_snapshot(
            source_project_id=7,
            sheet_layer_id=11,
            layer_key="L1::PROC_A::010::ACT",
            capture_batch_id="0123456789abcdef0123456789abcdef",
            columns=(
                BackboneSnapshotColumn(
                    parameter_code="alpha",
                    value_type=ValueType.TEXT,
                    display_name="Alpha",
                    category_code="photo",
                    sort_order=1,
                    active_at_capture=True,
                ),
            ),
            conditions=(baseline_condition,),
        )
        layer = BackboneDiffLayerInput(
            layer_key="L1::PROC_A::010::ACT",
            layer_sort_order=1,
            current_source=BackboneDiffCurrentLayerSource(
                project_id=7,
                sheet_layer_id=11,
                layer_key="L1::PROC_A::010::ACT",
                step_seq="010",
                layer_id="ACT",
                sort_order=1,
                source_project_id=None,
                source_layer_key=None,
            ),
            baseline_snapshot=type_mismatch_snapshot,
            current_conditions=(current_condition,),
            current_parameters=(
                BackboneDiffCurrentParameter(
                    code="alpha",
                    value_type=ValueType.NUMBER,
                    display_name="Alpha",
                    category_code="photo",
                    sort_order=1,
                    active=True,
                ),
            ),
        )
        return BackboneDiffProjectInput(
            project_id=7,
            line_id="L1",
            process_id="PROC_A",
            part_id="PART_A",
            project_name="Project A",
            project_status="draft",
            captured_at=datetime.now(UTC),
            layers=(layer,),
        )

    async def _unresolved_metadata_input(project_id: int) -> BackboneDiffProjectInput:
        del project_id
        layer = BackboneDiffLayerInput(
            layer_key="L1::PROC_A::010::ACT",
            layer_sort_order=1,
            current_source=BackboneDiffCurrentLayerSource(
                project_id=7,
                sheet_layer_id=11,
                layer_key="L1::PROC_A::010::ACT",
                step_seq="010",
                layer_id="ACT",
                sort_order=1,
                source_project_id=None,
                source_layer_key=None,
            ),
            baseline_snapshot=_valid_baseline_snapshot(
                source_project_id=7,
                sheet_layer_id=11,
                layer_key="L1::PROC_A::010::ACT",
                capture_batch_id="0123456789abcdef0123456789abcdef",
                columns=columns,
                conditions=(baseline_condition,),
            ),
            current_conditions=(
                BackboneDiffCurrentCondition(
                    id=201,
                    source_condition_id=101,
                    label="base current",
                    condition_index=0,
                    is_por=True,
                    cells=(BackboneDiffCurrentCell(parameter_code="gamma", value="fresh"),),
                ),
            ),
            current_parameters=(current_parameter,),
        )
        return BackboneDiffProjectInput(
            project_id=7,
            line_id="L1",
            process_id="PROC_A",
            part_id="PART_A",
            project_name="Project A",
            project_status="draft",
            captured_at=datetime.now(UTC),
            layers=(layer,),
        )

    await _assert_provider_conflict(
        provider,
        monkeypatch,
        await _invalid_backbone_input(7),
        "invalid_backbone_snapshot",
    )
    await _assert_provider_conflict(
        provider,
        monkeypatch,
        await _type_mismatch_input(7),
        "diff_basis_invalid",
    )
    await _assert_provider_conflict(
        provider,
        monkeypatch,
        await _unresolved_metadata_input(7),
        "unresolved_parameter_metadata",
    )


@pytest.mark.asyncio
async def test_backbone_diff_missing_project_returns_404(db_client: AsyncClient) -> None:
    response = await db_client.get("/api/projects/999999/backbone-diff")
    assert response.status_code == 404
    assert response.json()["code"] == "project_not_found"


@pytest.mark.asyncio
async def test_backbone_diff_branch_scope_tamper_is_rejected(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project = await _seed_project(db_session)
    root = await db_client.get(f"/api/projects/{project.id}/backbone-diff")
    branch_scope = root.json()["layer_summaries"][0]["branch_scope"]

    response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/WRONG::LAYER/conditions",
        params={"scope": branch_scope},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_scope"


@pytest.mark.asyncio
async def test_backbone_diff_stale_scope_triggers_diff_basis_changed(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project = await _seed_project(db_session)
    stale_scope = encode_backbone_diff_scope(
        BackboneDiffBranchScope(
            project_id=project.id,
            layer_key="L1::PROC_A::010::ACT",
            basis_hash="sha256:" + "2" * 64,
            filters=BackboneDiffFilters(),
        )
    )
    response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": stale_scope},
    )
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "diff_basis_changed"


def test_backbone_diff_provider_conflict_preserves_structured_details() -> None:
    provider = object.__new__(BackboneDiffProvider)
    exc = cast(Any, RuleViolationError("backbone diff basis changed", code="diff_basis_invalid"))
    exc.details = {"rule_code": "diff_basis_invalid", "parameter_code": "alpha"}

    with pytest.raises(ConflictError) as excinfo:
        provider._raise_conflict_on_rule_violation(exc)

    assert excinfo.value.code == "diff_basis_invalid"
    assert excinfo.value.details == {
        "rule_code": "diff_basis_invalid",
        "parameter_code": "alpha",
    }


@pytest.mark.asyncio
async def test_backbone_diff_route_rejects_noncanonical_and_malformed_tokens_before_loader(
    db_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = await _seed_project(db_session)
    root = await db_client.get(f"/api/projects/{project.id}/backbone-diff")
    branch_scope = root.json()["layer_summaries"][0]["branch_scope"]
    branch = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope},
    )
    row_ref = branch.json()["items"][0]["row_ref"]
    cell_scope = branch.json()["items"][0]["cell_scope"]

    async def _fail_load_input(*args: Any, **kwargs: Any) -> BackboneDiffProjectInput:
        del args, kwargs
        raise AssertionError("provider load should not be called for malformed tokens")

    monkeypatch.setattr(BackboneDiffProvider, "_load_input", _fail_load_input)

    malformed_scope = _encode_noncanonical_token(_decode_token_payload(branch_scope))
    scope_response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": malformed_scope},
    )
    assert scope_response.status_code == 422
    assert scope_response.json()["code"] == "invalid_scope"

    whitespace_scope_response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": f" {branch_scope} "},
    )
    assert whitespace_scope_response.status_code == 422
    assert whitespace_scope_response.json()["code"] == "invalid_scope"

    malformed_row_ref_payload = _decode_token_payload(row_ref)
    malformed_row_ref_payload["project_id"] = 0
    malformed_row_ref = _encode_token_payload(malformed_row_ref_payload)
    row_ref_response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions/{malformed_row_ref}/cells",
        params={"scope": cell_scope},
    )
    assert row_ref_response.status_code == 422
    assert row_ref_response.json()["code"] == "invalid_row_ref"

    valid_cursor = encode_backbone_diff_cursor(
        BackboneDiffCursor(
            version=1,
            kind="branch",
            scope=decode_backbone_diff_scope(branch_scope),
            sort_key=(1, 1, 1),
        )
    )
    malformed_cursor_payload = _decode_token_payload(valid_cursor)
    malformed_cursor_payload["sort_key"] = [1, "bad"]
    malformed_cursor = _encode_token_payload(malformed_cursor_payload)
    cursor_response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope, "cursor": malformed_cursor},
    )
    assert cursor_response.status_code == 422
    assert cursor_response.json()["code"] == "invalid_cursor"

    whitespace_cursor_response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope, "cursor": f" {valid_cursor} "},
    )
    assert whitespace_cursor_response.status_code == 422
    assert whitespace_cursor_response.json()["code"] == "invalid_cursor"


@pytest.mark.asyncio
async def test_backbone_diff_cell_row_ref_tamper_is_rejected(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    project = await _seed_project(db_session)
    root = await db_client.get(f"/api/projects/{project.id}/backbone-diff")
    branch_scope = root.json()["layer_summaries"][0]["branch_scope"]
    branch = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions",
        params={"scope": branch_scope},
    )
    row_ref = branch.json()["items"][0]["row_ref"]
    cell_scope = branch.json()["items"][0]["cell_scope"]

    bad_row_ref = encode_backbone_diff_row_ref(
        replace(
            decode_backbone_diff_row_ref(row_ref),
            current_condition_id=999,
        )
    )
    response = await db_client.get(
        f"/api/projects/{project.id}/backbone-diff/layers/L1::PROC_A::010::ACT/conditions/{bad_row_ref}/cells",
        params={"scope": cell_scope},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_row_ref"


@pytest.mark.asyncio
async def test_backbone_diff_routes_execute_auth_dependency(
    db_client: AsyncClient,
) -> None:
    async def _reject_auth(request: Request) -> None:
        del request
        raise AppError("authentication required", code="unauthorized", status_code=401)

    from app.main import app

    app.dependency_overrides[get_current_user] = _reject_auth
    try:
        response = await db_client.get("/api/projects/7/backbone-diff")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"
