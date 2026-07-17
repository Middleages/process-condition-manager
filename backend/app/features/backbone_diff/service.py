"""Read-only orchestration for backbone diff endpoints."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from time import perf_counter
from typing import Protocol, cast

from app.core.errors import AppError, ConflictError
from app.domain.errors import DomainError, RuleViolationError
from app.features.backbone_diff.cursor import (
    BackboneDiffBranchScope,
    BackboneDiffCellScope,
    BackboneDiffCursor,
    BackboneDiffRowRef,
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

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class _SummaryMetrics:
    load_ms: float
    query_ms: float
    compute_ms: float
    layer_count: int
    row_count: int
    cell_count: int
    baseline_unavailable: int
    anomaly: int


def _status_code_for_exception(exc: Exception) -> int:
    if isinstance(exc, AppError):
        return exc.status_code
    if isinstance(exc, DomainError):
        return 422
    return 500


class BackboneDiffProvider(Protocol):
    async def load_root(
        self,
        project_id: int,
        query: BackboneDiffRootQueryIn,
        *,
        with_metrics: bool = False,
    ) -> BackboneDiffRootOut | tuple[BackboneDiffRootOut, object]: ...

    async def load_conditions(
        self,
        project_id: int,
        layer_key: str,
        scope: BackboneDiffBranchScope,
        query: BackboneDiffBranchQueryIn,
        cursor: BackboneDiffCursor | None,
        *,
        with_metrics: bool = False,
    ) -> BackboneDiffConditionPageOut | tuple[BackboneDiffConditionPageOut, object]: ...

    async def load_cells(
        self,
        project_id: int,
        layer_key: str,
        row_ref: BackboneDiffRowRef,
        scope: BackboneDiffCellScope,
        query: BackboneDiffCellQueryIn,
        cursor: BackboneDiffCursor | None,
        *,
        with_metrics: bool = False,
    ) -> BackboneDiffCellPageOut | tuple[BackboneDiffCellPageOut, object]: ...


class BackboneDiffService:
    """Normalize and validate backbone diff requests before provider execution."""

    def __init__(self, provider: BackboneDiffProvider) -> None:
        self.provider = provider

    def _provider(self) -> BackboneDiffProvider:
        return self.provider

    def _log_summary(
        self,
        *,
        operation: str,
        project_id: int,
        started: float,
        status: int,
        count: int,
        metrics: _SummaryMetrics | object,
    ) -> None:
        logger.info(
            "backbone_diff_request_summary",
            extra={
                "operation": operation,
                "route": operation,
                "project_id": project_id,
                "duration_ms": round((perf_counter() - started) * 1000, 3),
                "load_ms": round(getattr(metrics, "load_ms", 0.0), 3),
                "query_ms": round(getattr(metrics, "query_ms", 0.0), 3),
                "compute_ms": round(getattr(metrics, "compute_ms", 0.0), 3),
                "count": count,
                "layer_count": getattr(metrics, "layer_count", 0),
                "row_count": getattr(metrics, "row_count", 0),
                "cell_count": getattr(metrics, "cell_count", 0),
                "baseline_unavailable": getattr(metrics, "baseline_unavailable", 0),
                "anomaly": getattr(metrics, "anomaly", 0),
                "status": status,
            },
        )

    async def root(self, project_id: int, query: BackboneDiffRootQueryIn) -> BackboneDiffRootOut:
        started = perf_counter()
        try:
            result, metrics = cast(
                tuple[BackboneDiffRootOut, object],
                await self._provider().load_root(project_id, query, with_metrics=True),
            )
        except Exception as exc:
            self._log_summary(
                operation="root",
                project_id=project_id,
                started=started,
                status=_status_code_for_exception(exc),
                count=0,
                metrics=_SummaryMetrics(
                    load_ms=0.0,
                    query_ms=0.0,
                    compute_ms=0.0,
                    layer_count=0,
                    row_count=0,
                    cell_count=0,
                    baseline_unavailable=0,
                    anomaly=0,
                ),
            )
            raise
        self._log_summary(
            operation="root",
            project_id=project_id,
            started=started,
            status=200,
            count=len(result.changed_preview),
            metrics=metrics,
        )
        return result

    async def conditions(
        self, project_id: int, layer_key: str, query: BackboneDiffBranchQueryIn
    ) -> BackboneDiffConditionPageOut:
        started = perf_counter()
        try:
            scope = decode_backbone_diff_scope(query.scope)
            if not isinstance(scope, BackboneDiffBranchScope):
                raise RuleViolationError("scope must be a branch scope", code="invalid_scope")
            if scope.project_id != project_id or scope.layer_key != layer_key:
                raise RuleViolationError("scope does not match request path", code="invalid_scope")

            cursor = None
            if query.cursor is not None:
                cursor = decode_backbone_diff_cursor(query.cursor)
                if cursor.kind != "branch":
                    raise RuleViolationError(
                        "cursor kind does not match branch request", code="invalid_cursor"
                    )
                if not isinstance(cursor.scope, BackboneDiffBranchScope) or cursor.scope != scope:
                    raise RuleViolationError(
                        "cursor scope does not match request scope", code="invalid_cursor"
                    )

            result, metrics = cast(
                tuple[BackboneDiffConditionPageOut, object],
                await self._provider().load_conditions(
                    project_id, layer_key, scope, query, cursor, with_metrics=True
                ),
            )
            if result.basis_hash != scope.basis_hash:
                raise ConflictError(
                    "backbone diff basis changed",
                    code="diff_basis_changed",
                    details={"rule_code": "diff_basis_changed"},
                )
            if cursor is not None and cursor.scope.basis_hash != result.basis_hash:
                raise ConflictError(
                    "backbone diff basis changed",
                    code="diff_basis_changed",
                    details={"rule_code": "diff_basis_changed"},
                )
            if result.scope != query.scope:
                raise RuleViolationError(
                    "response scope does not match request scope", code="invalid_scope"
                )
        except Exception as exc:
            self._log_summary(
                operation="conditions",
                project_id=project_id,
                started=started,
                status=_status_code_for_exception(exc),
                count=0,
                metrics=_SummaryMetrics(
                    load_ms=0.0,
                    query_ms=0.0,
                    compute_ms=0.0,
                    layer_count=0,
                    row_count=0,
                    cell_count=0,
                    baseline_unavailable=0,
                    anomaly=0,
                ),
            )
            raise
        self._log_summary(
            operation="conditions",
            project_id=project_id,
            started=started,
            status=200,
            count=len(result.items),
            metrics=metrics,
        )
        return result

    async def cells(
        self, project_id: int, layer_key: str, row_ref_token: str, query: BackboneDiffCellQueryIn
    ) -> BackboneDiffCellPageOut:
        started = perf_counter()
        try:
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
                    raise RuleViolationError(
                        "cursor kind does not match cell request", code="invalid_cursor"
                    )
                if not isinstance(cursor.scope, BackboneDiffCellScope) or cursor.scope != scope:
                    raise RuleViolationError(
                        "cursor scope does not match request scope", code="invalid_cursor"
                    )

            result, metrics = cast(
                tuple[BackboneDiffCellPageOut, object],
                await self._provider().load_cells(
                    project_id, layer_key, row_ref, scope, query, cursor, with_metrics=True
                ),
            )
            if result.basis_hash != scope.basis_hash:
                raise ConflictError(
                    "backbone diff basis changed",
                    code="diff_basis_changed",
                    details={"rule_code": "diff_basis_changed"},
                )
            if cursor is not None and cursor.scope.basis_hash != result.basis_hash:
                raise ConflictError(
                    "backbone diff basis changed",
                    code="diff_basis_changed",
                    details={"rule_code": "diff_basis_changed"},
                )
            if result.scope != query.scope or result.row_ref != (
                encode_backbone_diff_row_ref(row_ref)
            ):
                raise RuleViolationError(
                    "response scope does not match request scope", code="invalid_scope"
                )
        except Exception as exc:
            self._log_summary(
                operation="cells",
                project_id=project_id,
                started=started,
                status=_status_code_for_exception(exc),
                count=0,
                metrics=_SummaryMetrics(
                    load_ms=0.0,
                    query_ms=0.0,
                    compute_ms=0.0,
                    layer_count=0,
                    row_count=0,
                    cell_count=0,
                    baseline_unavailable=0,
                    anomaly=0,
                ),
            )
            raise
        self._log_summary(
            operation="cells",
            project_id=project_id,
            started=started,
            status=200,
            count=len(result.items),
            metrics=metrics,
        )
        return result


__all__ = ["BackboneDiffProvider", "BackboneDiffService"]
