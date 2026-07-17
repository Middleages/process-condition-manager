"""Read-only orchestration for backbone diff endpoints."""

from __future__ import annotations

from typing import Protocol

from app.core.errors import AppError, ConflictError
from app.domain.errors import RuleViolationError
from app.features.backbone_diff.cursor import (
    BackboneDiffBranchScope,
    BackboneDiffCellScope,
    BackboneDiffCursor,
    BackboneDiffRowRef,
    BackboneDiffRootScope,
    decode_backbone_diff_cursor,
    decode_backbone_diff_row_ref,
    decode_backbone_diff_scope,
    encode_backbone_diff_row_ref,
)
from app.features.backbone_diff.schema import (
    BackboneDiffBranchQueryIn,
    BackboneDiffCellPageOut,
    BackboneDiffCellQueryIn,
    BackboneDiffConditionPageOut,
    BackboneDiffRootOut,
    BackboneDiffRootQueryIn,
)


class BackboneDiffProvider(Protocol):
    async def load_root(self, project_id: int, query: BackboneDiffRootQueryIn) -> BackboneDiffRootOut:
        ...

    async def load_conditions(
        self,
        project_id: int,
        layer_key: str,
        scope: BackboneDiffBranchScope,
        query: BackboneDiffBranchQueryIn,
        cursor: BackboneDiffCursor | None,
    ) -> BackboneDiffConditionPageOut:
        ...

    async def load_cells(
        self,
        project_id: int,
        layer_key: str,
        row_ref: BackboneDiffRowRef,
        scope: BackboneDiffCellScope,
        query: BackboneDiffCellQueryIn,
        cursor: BackboneDiffCursor | None,
    ) -> BackboneDiffCellPageOut:
        ...


class BackboneDiffService:
    """Normalize and validate backbone diff requests before provider execution."""

    def __init__(self, provider: BackboneDiffProvider | None) -> None:
        self.provider = provider

    def _provider(self) -> BackboneDiffProvider:
        if self.provider is None:
            raise AppError(
                "backbone diff provider is unavailable",
                code="backbone_diff_unavailable",
                status_code=503,
            )
        return self.provider

    async def root(self, project_id: int, query: BackboneDiffRootQueryIn) -> BackboneDiffRootOut:
        return await self._provider().load_root(project_id, query)

    async def conditions(
        self, project_id: int, layer_key: str, query: BackboneDiffBranchQueryIn
    ) -> BackboneDiffConditionPageOut:
        scope = decode_backbone_diff_scope(query.scope)
        if not isinstance(scope, BackboneDiffBranchScope):
            raise RuleViolationError("scope must be a branch scope", code="invalid_scope")
        if scope.project_id != project_id or scope.layer_key != layer_key:
            raise RuleViolationError("scope does not match request path", code="invalid_scope")

        cursor = None
        if query.cursor is not None:
            cursor = decode_backbone_diff_cursor(query.cursor)
            if cursor.kind != "branch":
                raise RuleViolationError("cursor kind does not match branch request", code="invalid_cursor")
            if cursor.scope != scope:
                raise RuleViolationError("cursor scope does not match request scope", code="invalid_cursor")

        result = await self._provider().load_conditions(project_id, layer_key, scope, query, cursor)
        if result.basis_hash != scope.basis_hash:
            raise ConflictError("backbone diff basis changed", code="diff_basis_changed")
        if cursor is not None and cursor.scope.basis_hash != result.basis_hash:
            raise ConflictError("backbone diff basis changed", code="diff_basis_changed")
        if result.scope != query.scope:
            raise RuleViolationError("response scope does not match request scope", code="invalid_scope")
        return result

    async def cells(
        self, project_id: int, layer_key: str, row_ref_token: str, query: BackboneDiffCellQueryIn
    ) -> BackboneDiffCellPageOut:
        scope = decode_backbone_diff_scope(query.scope)
        if not isinstance(scope, BackboneDiffCellScope):
            raise RuleViolationError("scope must be a cell scope", code="invalid_scope")
        if scope.project_id != project_id or scope.layer_key != layer_key:
            raise RuleViolationError("scope does not match request path", code="invalid_scope")
        row_ref = decode_backbone_diff_row_ref(row_ref_token)
        if row_ref != scope.row_ref:
            raise RuleViolationError("row_ref does not match scope", code="invalid_row_ref")

        cursor = None
        if query.cursor is not None:
            cursor = decode_backbone_diff_cursor(query.cursor)
            if cursor.kind != "cell":
                raise RuleViolationError("cursor kind does not match cell request", code="invalid_cursor")
            if cursor.scope != scope:
                raise RuleViolationError("cursor scope does not match request scope", code="invalid_cursor")

        result = await self._provider().load_cells(project_id, layer_key, row_ref, scope, query, cursor)
        if result.basis_hash != scope.basis_hash:
            raise ConflictError("backbone diff basis changed", code="diff_basis_changed")
        if cursor is not None and cursor.scope.basis_hash != result.basis_hash:
            raise ConflictError("backbone diff basis changed", code="diff_basis_changed")
        if result.scope != query.scope or result.row_ref != encode_backbone_diff_row_ref(row_ref):
            raise RuleViolationError("response scope does not match request scope", code="invalid_scope")
        return result


__all__ = ["BackboneDiffProvider", "BackboneDiffService"]
