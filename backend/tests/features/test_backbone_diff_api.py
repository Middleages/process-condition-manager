from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi import Request
from httpx import AsyncClient

from app.core.auth import get_current_user
from app.core.errors import AppError
from app.features.backbone_diff.cursor import (
    BackboneDiffBranchScope,
    BackboneDiffCellScope,
    BackboneDiffCursor,
    BackboneDiffFilters,
    BackboneDiffRowRef,
    BackboneDiffRootScope,
    decode_backbone_diff_cursor,
    decode_backbone_diff_row_ref,
    decode_backbone_diff_scope,
    encode_backbone_diff_cursor,
    encode_backbone_diff_row_ref,
    encode_backbone_diff_scope,
)
from app.features.backbone_diff.router import get_service
from app.features.backbone_diff.schema import (
    BackboneDiffBranchQueryIn,
    BackboneDiffCellItemOut,
    BackboneDiffCellPageOut,
    BackboneDiffCellQueryIn,
    BackboneDiffConditionItemOut,
    BackboneDiffConditionMetadataOut,
    BackboneDiffConditionPageOut,
    BackboneDiffCountsOut,
    BackboneDiffLayerSummaryOut,
    BackboneDiffParameterMetadataOut,
    BackboneDiffPreviewItemOut,
    BackboneDiffRootOut,
    BackboneDiffRootQueryIn,
    BackboneDiffRowMetadataOut,
)
from app.features.backbone_diff.service import BackboneDiffService
from app.main import app


class FakeBackboneDiffProvider:
    def __init__(
        self,
        *,
        root: BackboneDiffRootOut,
        branch: BackboneDiffConditionPageOut,
        cell: BackboneDiffCellPageOut,
    ) -> None:
        self.root = root
        self.branch = branch
        self.cell = cell

    async def load_root(
        self, project_id: int, query: BackboneDiffRootQueryIn
    ) -> BackboneDiffRootOut:
        assert project_id == 7
        assert query.preview_limit == 1
        return self.root

    async def load_conditions(
        self,
        project_id: int,
        layer_key: str,
        scope: BackboneDiffBranchScope,
        query: BackboneDiffBranchQueryIn,
        cursor,
    ) -> BackboneDiffConditionPageOut:
        assert project_id == 7
        assert layer_key == "010::ACT"
        assert scope == decode_backbone_diff_scope(query.scope)
        if cursor is not None:
            assert cursor.scope == scope
        return self.branch

    async def load_cells(
        self,
        project_id: int,
        layer_key: str,
        row_ref: BackboneDiffRowRef,
        scope: BackboneDiffCellScope,
        query: BackboneDiffCellQueryIn,
        cursor,
    ) -> BackboneDiffCellPageOut:
        assert project_id == 7
        assert layer_key == "010::ACT"
        assert row_ref == scope.row_ref
        assert scope == decode_backbone_diff_scope(query.scope)
        if cursor is not None:
            assert cursor.scope == scope
        return self.cell


def _fixture_bundle() -> tuple[
    BackboneDiffRootScope,
    BackboneDiffBranchScope,
    BackboneDiffRowRef,
    BackboneDiffCellScope,
    BackboneDiffRootOut,
    BackboneDiffConditionPageOut,
    BackboneDiffCellPageOut,
]:
    filters = BackboneDiffFilters(
        classification=("added", "changed"),
        category_code="process",
        parameter_code="speed",
        include_unchanged=True,
    )
    root_scope = BackboneDiffRootScope(project_id=7, basis_hash="sha256:root", filters=filters)
    branch_scope = BackboneDiffBranchScope(
        project_id=7,
        layer_key="010::ACT",
        basis_hash="sha256:root",
        filters=filters,
    )
    row_ref = BackboneDiffRowRef(
        project_id=7,
        layer_key="010::ACT",
        row_status="matched",
        baseline_condition_id=11,
        current_condition_id=21,
    )
    cell_scope = BackboneDiffCellScope(
        project_id=7,
        layer_key="010::ACT",
        basis_hash="sha256:root",
        row_ref=row_ref,
        filters=filters,
    )
    root_scope_token = encode_backbone_diff_scope(root_scope)
    branch_scope_token = encode_backbone_diff_scope(branch_scope)
    cell_scope_token = encode_backbone_diff_scope(cell_scope)
    row_ref_token = encode_backbone_diff_row_ref(row_ref)
    root = BackboneDiffRootOut(
        scope=root_scope_token,
        basis_hash="sha256:root",
        counts=BackboneDiffCountsOut(
            layer_count=1,
            available_layer_count=1,
            unavailable_layer_count=0,
            row_count=2,
            cell_count=3,
            added_count=1,
            changed_count=1,
            cleared_count=0,
            removed_count=0,
            unchanged_count=0,
        ),
        layer_summaries=[
            BackboneDiffLayerSummaryOut(
                layer_key="010::ACT",
                layer_sort=1,
                layer_status="available",
                baseline_condition_count=1,
                current_condition_count=1,
                row_count=2,
                cell_count=3,
                changed_count=1,
                branch_scope=branch_scope_token,
            )
        ],
        changed_preview=[
            BackboneDiffPreviewItemOut(
                item_kind="row",
                classification="changed",
                layer_key="010::ACT",
                effective_condition_index=1,
                item_sort_key=["label"],
                status_rank=0,
                row_ref=row_ref_token,
            )
        ],
    )
    branch = BackboneDiffConditionPageOut(
        scope=branch_scope_token,
        basis_hash="sha256:root",
        items=[
            BackboneDiffConditionItemOut(
                row_ref=row_ref_token,
                row_status="matched",
                effective_condition_index=1,
                identity=21,
                baseline_condition=BackboneDiffConditionMetadataOut(
                    condition_id=11,
                    source_condition_id=11,
                    label="Baseline",
                    condition_index=1,
                    is_por=True,
                ),
                current_condition=BackboneDiffConditionMetadataOut(
                    condition_id=21,
                    source_condition_id=11,
                    label="Current",
                    condition_index=1,
                    is_por=True,
                ),
                row_metadata=BackboneDiffRowMetadataOut(
                    label_changed=True,
                    index_changed=False,
                    por_changed=False,
                ),
                filtered_cell_count=2,
                full_cell_count=2,
                jump_status="available",
                cell_scope=cell_scope_token,
            )
        ],
        next_cursor=None,
    )
    cell = BackboneDiffCellPageOut(
        scope=cell_scope_token,
        basis_hash="sha256:root",
        row_ref=row_ref_token,
        items=[
            BackboneDiffCellItemOut(
                classification="changed",
                reason="typed value changed",
                parameter_code="speed",
                parameter_sort=1,
                baseline_value="1.0",
                current_value="2.0",
                baseline_metadata=BackboneDiffParameterMetadataOut(
                    parameter_code="speed",
                    value_type="number",
                    display_name="Speed",
                    category_code="process",
                    sort_order=1,
                    active=True,
                ),
                current_metadata=BackboneDiffParameterMetadataOut(
                    parameter_code="speed",
                    value_type="number",
                    display_name="Speed",
                    category_code="process",
                    sort_order=1,
                    active=True,
                ),
                jump_status="available",
            )
        ],
        next_cursor=None,
    )
    return root_scope, branch_scope, row_ref, cell_scope, root, branch, cell


@pytest.mark.asyncio
async def test_backbone_diff_tokens_round_trip() -> None:
    root_scope, branch_scope, row_ref, cell_scope, *_ = _fixture_bundle()

    assert decode_backbone_diff_scope(encode_backbone_diff_scope(root_scope)) == root_scope
    assert decode_backbone_diff_scope(encode_backbone_diff_scope(branch_scope)) == branch_scope
    assert decode_backbone_diff_scope(encode_backbone_diff_scope(cell_scope)) == cell_scope
    assert decode_backbone_diff_row_ref(encode_backbone_diff_row_ref(row_ref)) == row_ref

    cursor = BackboneDiffCursor(
        version=1,
        kind="branch",
        scope=branch_scope,
        sort_key=(1, "21"),
    )
    assert decode_backbone_diff_cursor(encode_backbone_diff_cursor(cursor)) == cursor


@pytest.mark.asyncio
async def test_backbone_diff_root_route_returns_preview_and_scopes(client: AsyncClient) -> None:
    _, _, _, _, root, branch, cell = _fixture_bundle()
    service = BackboneDiffService(FakeBackboneDiffProvider(root=root, branch=branch, cell=cell))
    app.dependency_overrides[get_service] = lambda: service
    try:
        response = await client.get(
            "/api/projects/7/backbone-diff",
            params=[
                ("classification", "changed"),
                ("classification", "added"),
                ("include_unchanged", "true"),
                ("preview_limit", "1"),
            ],
        )
    finally:
        app.dependency_overrides.pop(get_service, None)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["basis_hash"] == "sha256:root"
    assert body["counts"]["layer_count"] == 1
    assert body["layer_summaries"][0]["branch_scope"] is not None
    assert body["changed_preview"][0]["row_ref"] is not None


@pytest.mark.asyncio
async def test_backbone_diff_branch_scope_tamper_is_rejected(client: AsyncClient) -> None:
    _, branch_scope, _, _, root, branch, cell = _fixture_bundle()
    service = BackboneDiffService(FakeBackboneDiffProvider(root=root, branch=branch, cell=cell))
    app.dependency_overrides[get_service] = lambda: service
    try:
        response = await client.get(
            "/api/projects/7/backbone-diff/layers/WRONG::LAYER/conditions",
            params={"scope": encode_backbone_diff_scope(branch_scope)},
        )
    finally:
        app.dependency_overrides.pop(get_service, None)

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_scope"


@pytest.mark.asyncio
async def test_backbone_diff_branch_stale_cursor_triggers_diff_basis_changed(
    client: AsyncClient,
) -> None:
    _, branch_scope, _, _, root, branch, cell = _fixture_bundle()
    stale_cursor = BackboneDiffCursor(
        version=1,
        kind="branch",
        scope=replace(branch_scope, basis_hash="sha256:stale"),
        sort_key=(1, "21"),
    )
    current_branch = replace(branch, basis_hash="sha256:current")
    service = BackboneDiffService(FakeBackboneDiffProvider(root=root, branch=current_branch, cell=cell))
    app.dependency_overrides[get_service] = lambda: service
    try:
        response = await client.get(
            "/api/projects/7/backbone-diff/layers/010::ACT/conditions",
            params={
                "scope": encode_backbone_diff_scope(branch_scope),
                "cursor": encode_backbone_diff_cursor(stale_cursor),
            },
        )
    finally:
        app.dependency_overrides.pop(get_service, None)

    assert response.status_code == 409
    assert response.json()["code"] == "diff_basis_changed"


@pytest.mark.asyncio
async def test_backbone_diff_cell_row_ref_tamper_is_rejected(client: AsyncClient) -> None:
    _, branch_scope, row_ref, cell_scope, root, branch, cell = _fixture_bundle()
    bad_row_ref = encode_backbone_diff_row_ref(
        replace(row_ref, current_condition_id=99, baseline_condition_id=11)
    )
    service = BackboneDiffService(FakeBackboneDiffProvider(root=root, branch=branch, cell=cell))
    app.dependency_overrides[get_service] = lambda: service
    try:
        response = await client.get(
            "/api/projects/7/backbone-diff/layers/010::ACT/conditions/"
            f"{encode_backbone_diff_row_ref(row_ref)}/cells",
            params={"scope": encode_backbone_diff_scope(cell_scope)},
        )
    finally:
        app.dependency_overrides.pop(get_service, None)

    assert response.status_code == 200, response.text

    app.dependency_overrides[get_service] = lambda: service
    try:
        bad_response = await client.get(
            "/api/projects/7/backbone-diff/layers/010::ACT/conditions/"
            f"{bad_row_ref}/cells",
            params={"scope": encode_backbone_diff_scope(cell_scope)},
        )
    finally:
        app.dependency_overrides.pop(get_service, None)

    assert bad_response.status_code == 422
    assert bad_response.json()["code"] == "invalid_row_ref"


@pytest.mark.asyncio
async def test_backbone_diff_routes_execute_auth_dependency(client: AsyncClient) -> None:
    async def _reject_auth(request: Request) -> None:
        del request
        raise AppError("authentication required", code="unauthorized", status_code=401)

    app.dependency_overrides[get_current_user] = _reject_auth
    try:
        response = await client.get("/api/projects/7/backbone-diff")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"
