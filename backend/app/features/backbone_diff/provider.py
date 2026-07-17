"""Concrete backbone diff provider backed by one immutable snapshot load."""

from __future__ import annotations

import json
from dataclasses import dataclass
from time import perf_counter
from typing import Any, cast

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession, async_sessionmaker

from app.core.errors import ConflictError, NotFoundError
from app.domain.backbone.diff import (
    BackboneDiffCurrentParameter,
    BackboneDiffLayerInput,
    BackboneDiffLayerResult,
    BackboneDiffResult,
    BackboneDiffRow,
    backbone_diff_basis_hash,
    compare_backbone,
    compare_backbone_layer,
)
from app.domain.backbone.snapshot import BackboneSnapshotColumn
from app.domain.errors import RuleViolationError
from app.features.backbone_diff.contracts import BackboneDiffProjectInput
from app.features.backbone_diff.cursor import (
    BackboneDiffBranchScope,
    BackboneDiffCellScope,
    BackboneDiffClassification,
    BackboneDiffCursor,
    BackboneDiffFilters,
    BackboneDiffRootScope,
    BackboneDiffRowRef,
    BackboneDiffRowStatus,
    encode_backbone_diff_cursor,
    encode_backbone_diff_row_ref,
    encode_backbone_diff_scope,
)
from app.features.backbone_diff.read_snapshot import (
    build_read_only_sessionmaker,
    load_diff_input_with_session_factory,
)
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

_ROW_STATUS_RANK: dict[BackboneDiffRowStatus, int] = {
    "matched": 0,
    "added": 1,
    "removed": 2,
}

_CONFLICT_RULE_CODES = {
    "invalid_backbone_snapshot",
    "diff_basis_invalid",
    "unresolved_parameter_metadata",
}

_MAX_PUBLIC_CELL_VALUE_LENGTH = 4096
_MAX_CELL_RESPONSE_BYTES = 256 * 1024


@dataclass(frozen=True, slots=True)
class _LayerBundle:
    project_id: int
    result: BackboneDiffLayerResult
    input: BackboneDiffLayerInput
    current_source_condition_ids: dict[int, int | None]
    selected_current_parameters_by_code: dict[str, BackboneDiffCurrentParameter]
    baseline_columns_by_code: dict[str, BackboneSnapshotColumn]


@dataclass(frozen=True, slots=True)
class _RequestMetrics:
    load_ms: float
    query_ms: float
    compute_ms: float
    layer_count: int
    row_count: int
    cell_count: int
    baseline_unavailable: int
    anomaly: int


class BackboneDiffProvider:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    async def load_root(
        self,
        project_id: int,
        query: BackboneDiffRootQueryIn,
        *,
        with_metrics: bool = False,
    ) -> BackboneDiffRootOut | tuple[BackboneDiffRootOut, _RequestMetrics]:
        try:
            load_started = perf_counter()
            diff_input = await self._load_input(project_id)
            load_ms = (perf_counter() - load_started) * 1000
            compute_started = perf_counter()
            result: BackboneDiffResult = compare_backbone(diff_input.layers)
            filters = self._filters_from_query(query)
            bundles = self._bundle_pairs(result, diff_input)
            root_scope = BackboneDiffRootScope(
                project_id=diff_input.project_id,
                basis_hash=result.basis_hash,
                filters=filters,
            )
            counts, layer_summaries, previews = self._project_root(
                bundles,
                filters,
                query.layer_key,
                query.preview_limit,
                result.basis_hash,
            )
            response = BackboneDiffRootOut(
                scope=encode_backbone_diff_scope(root_scope),
                basis_hash=result.basis_hash,
                counts=counts,
                layer_summaries=layer_summaries,
                changed_preview=previews,
            )
            if not with_metrics:
                return response
            return (
                response,
                _RequestMetrics(
                    load_ms=load_ms,
                    query_ms=0.0,
                    compute_ms=(perf_counter() - compute_started) * 1000,
                    layer_count=counts.layer_count,
                    row_count=counts.row_count,
                    cell_count=counts.cell_count,
                    baseline_unavailable=counts.unavailable_layer_count,
                    anomaly=counts.ambiguous_lineage_count,
                ),
            )
        except RuleViolationError as exc:
            self._raise_conflict_on_rule_violation(exc)
            raise

    async def load_conditions(
        self,
        project_id: int,
        layer_key: str,
        scope: BackboneDiffBranchScope,
        query: BackboneDiffBranchQueryIn,
        cursor: BackboneDiffCursor | None,
        *,
        with_metrics: bool = False,
    ) -> BackboneDiffConditionPageOut | tuple[BackboneDiffConditionPageOut, _RequestMetrics]:
        try:
            load_started = perf_counter()
            diff_input = await self._load_input(project_id)
            load_ms = (perf_counter() - load_started) * 1000
            query_started = perf_counter()
            basis_hash = backbone_diff_basis_hash(diff_input.layers)
            if scope.basis_hash != basis_hash:
                raise ConflictError("backbone diff basis changed", code="diff_basis_changed")
            layer_input = self._load_layer_input(diff_input, layer_key)
            result = compare_backbone_layer(layer_input)
            bundle = self._bundle_for_layer(diff_input.project_id, layer_input, result)
            rows = self._branch_rows(bundle, scope.filters, basis_hash)
            page, next_cursor = self._page_branch_rows(rows, scope, query.limit, cursor)
            response = BackboneDiffConditionPageOut(
                scope=encode_backbone_diff_scope(
                    BackboneDiffBranchScope(
                        project_id=scope.project_id,
                        layer_key=scope.layer_key,
                        basis_hash=basis_hash,
                        filters=scope.filters,
                    )
                ),
                basis_hash=basis_hash,
                items=page,
                next_cursor=next_cursor,
            )
            if not with_metrics:
                return response
            return (
                response,
                _RequestMetrics(
                    load_ms=load_ms,
                    query_ms=(perf_counter() - query_started) * 1000,
                    compute_ms=0.0,
                    layer_count=1,
                    row_count=len(page),
                    cell_count=sum(item.filtered_cell_count for item in page),
                    baseline_unavailable=int(bundle.result.baseline_unavailable),
                    anomaly=bundle.result.ambiguous_lineage_count,
                ),
            )
        except RuleViolationError as exc:
            self._raise_conflict_on_rule_violation(exc)
            raise

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
    ) -> BackboneDiffCellPageOut | tuple[BackboneDiffCellPageOut, _RequestMetrics]:
        try:
            load_started = perf_counter()
            diff_input = await self._load_input(project_id)
            load_ms = (perf_counter() - load_started) * 1000
            query_started = perf_counter()
            basis_hash = backbone_diff_basis_hash(diff_input.layers)
            if scope.basis_hash != basis_hash:
                raise ConflictError("backbone diff basis changed", code="diff_basis_changed")
            layer_input = self._load_layer_input(diff_input, layer_key)
            result = compare_backbone_layer(layer_input)
            bundle = self._bundle_for_layer(diff_input.project_id, layer_input, result)
            row = self._find_row(bundle.result, row_ref)
            items = self._cell_items(bundle, row, scope.filters)
            page, next_cursor = self._page_cell_items(items, scope, query.limit, cursor)
            response = BackboneDiffCellPageOut(
                scope=encode_backbone_diff_scope(
                    BackboneDiffCellScope(
                        project_id=scope.project_id,
                        layer_key=scope.layer_key,
                        basis_hash=basis_hash,
                        row_ref=row_ref,
                        filters=scope.filters,
                    )
                ),
                basis_hash=basis_hash,
                row_ref=encode_backbone_diff_row_ref(row_ref),
                items=page,
                next_cursor=next_cursor,
            )
            if not with_metrics:
                return response
            return (
                response,
                _RequestMetrics(
                    load_ms=load_ms,
                    query_ms=(perf_counter() - query_started) * 1000,
                    compute_ms=0.0,
                    layer_count=1,
                    row_count=1,
                    cell_count=len(page),
                    baseline_unavailable=int(bundle.result.baseline_unavailable),
                    anomaly=bundle.result.ambiguous_lineage_count,
                ),
            )
        except RuleViolationError as exc:
            self._raise_conflict_on_rule_violation(exc)
            raise

    async def _load_input(self, project_id: int) -> BackboneDiffProjectInput:
        return await load_diff_input_with_session_factory(project_id, self._session_factory)

    def _raise_conflict_on_rule_violation(self, exc: RuleViolationError) -> None:
        if exc.code in _CONFLICT_RULE_CODES:
            rule_code = exc.code or "rule_violation"
            details = getattr(exc, "details", None)
            if details:
                details = dict(details)
            else:
                details = {"rule_code": rule_code}
            raise ConflictError(
                exc.message,
                code=rule_code,
                details=details,
            ) from exc

    def _filters_from_query(self, query: BackboneDiffRootQueryIn) -> BackboneDiffFilters:
        return BackboneDiffFilters(
            classification=query.classification,
            category_code=query.category_code,
            parameter_code=query.parameter_code,
            include_unchanged=query.include_unchanged,
        )

    def _bundle_pairs(
        self,
        result: BackboneDiffResult,
        diff_input: BackboneDiffProjectInput,
    ) -> list[_LayerBundle]:
        input_by_key = {layer_input.layer_key: layer_input for layer_input in diff_input.layers}
        bundles: list[_LayerBundle] = []
        for layer_result in result.layer_results:
            layer_input = input_by_key.get(layer_result.layer_key)
            if layer_input is None:
                raise NotFoundError(
                    f"backbone diff layer not found: {layer_result.layer_key}",
                    code="layer_not_found",
                    details={
                        "layer_key": layer_result.layer_key,
                        "project_id": diff_input.project_id,
                    },
                )
            bundles.append(self._bundle_for_layer(diff_input.project_id, layer_input, layer_result))
        return bundles

    def _bundle_for_layer(
        self,
        project_id: int,
        layer_input: BackboneDiffLayerInput,
        layer_result: BackboneDiffLayerResult,
    ) -> _LayerBundle:
        current_source_condition_ids = {
            condition.id: condition.source_condition_id
            for condition in layer_input.current_conditions
        }
        current_parameters_by_code = {
            parameter.code: parameter for parameter in layer_input.current_parameters
        }
        selected_current_codes = {
            parameter.code for parameter in layer_input.current_parameters if parameter.active
        }
        selected_current_codes.update(
            cell.parameter_code
            for condition in layer_input.current_conditions
            for cell in condition.cells
        )
        selected_current_parameters_by_code: dict[str, BackboneDiffCurrentParameter] = {}
        for code in sorted(selected_current_codes):
            parameter = current_parameters_by_code.get(code)
            if parameter is None:
                raise RuleViolationError(
                    f"missing current descriptor for parameter {code}",
                    code="unresolved_parameter_metadata",
                )
            selected_current_parameters_by_code[code] = parameter
        baseline_columns_by_code = (
            {column.parameter_code: column for column in layer_input.baseline_snapshot.columns}
            if layer_input.baseline_snapshot is not None
            else {}
        )
        return _LayerBundle(
            project_id=project_id,
            result=layer_result,
            input=layer_input,
            current_source_condition_ids=current_source_condition_ids,
            selected_current_parameters_by_code=selected_current_parameters_by_code,
            baseline_columns_by_code=baseline_columns_by_code,
        )

    def _load_layer_input(
        self, diff_input: BackboneDiffProjectInput, layer_key: str
    ) -> BackboneDiffLayerInput:
        for layer_input in diff_input.layers:
            if layer_input.layer_key == layer_key:
                return layer_input
        raise NotFoundError(
            f"backbone diff layer not found: {layer_key}",
            code="layer_not_found",
            details={"layer_key": layer_key, "project_id": diff_input.project_id},
        )

    def _project_root(
        self,
        layer_bundles: list[_LayerBundle],
        filters: BackboneDiffFilters,
        visible_layer_key: str | None,
        preview_limit: int,
        basis_hash: str,
    ) -> tuple[
        BackboneDiffCountsOut,
        list[BackboneDiffLayerSummaryOut],
        list[BackboneDiffPreviewItemOut],
    ]:
        classification_counts = {
            name: 0 for name in ("added", "changed", "cleared", "removed", "unchanged")
        }
        sorted_bundles = sorted(
            layer_bundles,
            key=lambda bundle: (
                bundle.input.layer_sort_order,
                bundle.input.layer_key,
            ),
        )
        layer_summaries: list[BackboneDiffLayerSummaryOut] = []
        previews: list[BackboneDiffPreviewItemOut] = []
        filtered_row_count = 0
        filtered_cell_count = 0
        full_row_count = 0
        full_cell_count = 0
        ambiguous_lineage_count = 0
        for bundle in sorted_bundles:
            is_visible = visible_layer_key is None or bundle.input.layer_key == visible_layer_key
            layer_filtered_row_count = 0
            layer_filtered_cell_count = 0
            layer_changed_count = 0
            layer_full_row_count = 0
            layer_full_cell_count = 0
            for row in bundle.result.rows:
                layer_full_row_count += 1
                full_row_count += 1
                for change in row.cell_changes:
                    classification_counts[change.classification] += 1
                    full_cell_count += 1
                    layer_full_cell_count += 1
                for _change in row.metadata_changes:
                    classification_counts["changed"] += 1
                row_visible = False
                for preview_kind, classification, item_sort_key, parameter_code in (
                    self._row_preview_candidates(row)
                ):
                    if not is_visible:
                        continue
                    if not self._candidate_matches_filters(
                        preview_kind,
                        cast(BackboneDiffClassification, classification),
                        parameter_code,
                        row,
                        bundle,
                        filters,
                    ):
                        continue
                    row_visible = True
                    layer_changed_count += 1
                    if preview_kind == "cell":
                        layer_filtered_cell_count += 1
                        filtered_cell_count += 1
                    if len(previews) < preview_limit:
                        previews.append(
                            self._build_preview_item(
                                bundle,
                                row,
                                preview_kind,
                                cast(BackboneDiffClassification, classification),
                                item_sort_key,
                                parameter_code,
                                filters,
                                basis_hash,
                            )
                        )
                if row_visible:
                    layer_filtered_row_count += 1
                    filtered_row_count += 1
            ambiguous_lineage_count += bundle.result.ambiguous_lineage_count
            if is_visible:
                layer_summaries.append(
                    BackboneDiffLayerSummaryOut(
                        layer_key=bundle.input.layer_key,
                        layer_sort=bundle.input.layer_sort_order,
                        layer_status="unavailable"
                        if bundle.result.baseline_unavailable
                        else "available",
                        baseline_condition_count=(
                            0
                            if bundle.result.baseline_unavailable
                            or bundle.input.baseline_snapshot is None
                            else len(bundle.input.baseline_snapshot.conditions)
                        ),
                        current_condition_count=len(bundle.input.current_conditions),
                        row_count=layer_filtered_row_count,
                        cell_count=layer_filtered_cell_count,
                        full_row_count=layer_full_row_count,
                        full_cell_count=layer_full_cell_count,
                        ambiguous_lineage_count=bundle.result.ambiguous_lineage_count,
                        changed_count=layer_changed_count,
                        branch_scope=(
                            encode_backbone_diff_scope(
                                BackboneDiffBranchScope(
                                    project_id=bundle.project_id,
                                    layer_key=bundle.input.layer_key,
                                    basis_hash=basis_hash,
                                    filters=filters,
                                )
                            )
                            if not bundle.result.baseline_unavailable
                            else None
                        ),
                    )
                )
        counts = BackboneDiffCountsOut(
            layer_count=len(layer_bundles),
            available_layer_count=sum(
                1 for bundle in layer_bundles if not bundle.result.baseline_unavailable
            ),
            unavailable_layer_count=sum(
                1 for bundle in layer_bundles if bundle.result.baseline_unavailable
            ),
            row_count=filtered_row_count,
            cell_count=filtered_cell_count,
            full_row_count=full_row_count,
            full_cell_count=full_cell_count,
            ambiguous_lineage_count=ambiguous_lineage_count,
            added_count=classification_counts["added"],
            changed_count=classification_counts["changed"],
            cleared_count=classification_counts["cleared"],
            removed_count=classification_counts["removed"],
            unchanged_count=classification_counts["unchanged"],
        )
        return counts, layer_summaries, previews

    def _candidate_matches_filters(
        self,
        preview_kind: str,
        classification: BackboneDiffClassification,
        parameter_code: str | None,
        row: BackboneDiffRow,
        bundle: _LayerBundle,
        filters: BackboneDiffFilters,
    ) -> bool:
        if preview_kind == "row_metadata":
            if filters.category_code is not None or filters.parameter_code is not None:
                return False
            if filters.classification and "changed" not in filters.classification:
                return False
            return filters.include_unchanged or classification != "unchanged"
        if classification == "unchanged" and not filters.include_unchanged:
            return False
        if filters.classification and classification not in filters.classification:
            return False
        if filters.parameter_code is not None and parameter_code != filters.parameter_code:
            return False
        if filters.category_code is None:
            return True
        if parameter_code is None:
            return any(
                self._parameter_category(
                    bundle,
                    cell.parameter_code,
                    baseline=self._change_uses_baseline_authority(row.row_status, cell),
                )
                == filters.category_code
                for cell in row.cell_changes
            )
        return self._parameter_category(
            bundle,
            parameter_code,
            baseline=self._change_uses_baseline_authority(
                row.row_status,
                None,
                classification=classification,
            ),
        ) == filters.category_code

    def _row_preview_candidates(
        self, row: BackboneDiffRow
    ) -> tuple[tuple[str, str, tuple[Any, ...], str | None], ...]:
        metadata_candidates = tuple(
            (
                "row_metadata",
                "changed",
                (change.field_name,),
                None,
            )
            for change in sorted(row.metadata_changes, key=lambda change: change.field_name)
        )
        cell_candidates = tuple(
            (
                "cell",
                change.classification,
                (change.sort_order, change.parameter_code),
                change.parameter_code,
            )
            for change in row.cell_changes
        )
        return metadata_candidates + cell_candidates

    def _build_preview_item(
        self,
        bundle: _LayerBundle,
        row: BackboneDiffRow,
        preview_kind: str,
        classification: BackboneDiffClassification,
        item_sort_key: tuple[Any, ...],
        parameter_code: str | None,
        filters: BackboneDiffFilters,
        basis_hash: str,
    ) -> BackboneDiffPreviewItemOut:
        row_ref = self._row_ref_for_row(bundle.project_id, bundle.input.layer_key, row)
        cell_scope = self._cell_scope_for_row(
            bundle.project_id,
            bundle.input.layer_key,
            row,
            filters,
            basis_hash,
        )
        return BackboneDiffPreviewItemOut(
            item_kind="row" if preview_kind == "row_metadata" else "cell",
            classification=classification,
            layer_key=bundle.input.layer_key,
            effective_condition_index=row.effective_condition_index,
            item_sort_key=list(item_sort_key),
            status_rank=_ROW_STATUS_RANK[row.row_status],
            row_ref=encode_backbone_diff_row_ref(row_ref),
            cell_scope=encode_backbone_diff_scope(cell_scope),
            row_status=row.row_status,
            parameter_code=parameter_code,
        )

    def _branch_rows(
        self, bundle: _LayerBundle, filters: BackboneDiffFilters, basis_hash: str
    ) -> list[BackboneDiffConditionItemOut]:
        rows: list[BackboneDiffConditionItemOut] = []
        for row in bundle.result.rows:
            cell_items = self._cell_items(bundle, row, filters)
            metadata_visible = bool(row.metadata_changes) and self._metadata_matches_filters(
                filters
            )
            if not cell_items and not metadata_visible:
                continue
            row_ref = self._row_ref_for_row(bundle.project_id, bundle.input.layer_key, row)
            rows.append(
                BackboneDiffConditionItemOut(
                    row_ref=encode_backbone_diff_row_ref(row_ref),
                    row_status=row.row_status,
                    effective_condition_index=row.effective_condition_index,
                    identity=row.identity,
                    baseline_condition=self._baseline_condition_metadata(row),
                    current_condition=self._current_condition_metadata(bundle, row),
                    row_metadata=self._row_metadata(row),
                    filtered_cell_count=len(cell_items),
                    full_cell_count=len(row.cell_changes),
                    jump_status="deleted" if row.row_status == "removed" else "available",
                    cell_scope=encode_backbone_diff_scope(
                        self._cell_scope_for_row(
                            bundle.project_id,
                            bundle.input.layer_key,
                            row,
                            filters,
                            basis_hash,
                        )
                    ),
                )
            )
        return rows

    def _cell_items(
        self,
        bundle: _LayerBundle,
        row: BackboneDiffRow,
        filters: BackboneDiffFilters,
    ) -> list[BackboneDiffCellItemOut]:
        items: list[BackboneDiffCellItemOut] = []
        for change in row.cell_changes:
            if not self._cell_change_matches_filters(bundle, change, filters):
                continue
            items.append(self._cell_item(bundle, row.row_status, change))
        return items

    def _cell_item(
        self, bundle: _LayerBundle, row_status: BackboneDiffRowStatus, change: Any
    ) -> BackboneDiffCellItemOut:
        baseline_value = self._require_public_cell_value(change.baseline_value)
        current_value = self._require_public_cell_value(change.current_value)
        return BackboneDiffCellItemOut(
            classification=change.classification,
            reason=change.reason,
            parameter_code=change.parameter_code,
            parameter_sort=change.sort_order,
            baseline_value=baseline_value,
            current_value=current_value,
            baseline_metadata=self._parameter_metadata(
                bundle, change.parameter_code, baseline=True, row_status=row_status
            ),
            current_metadata=self._parameter_metadata(
                bundle, change.parameter_code, baseline=False, row_status=row_status
            ),
            jump_status="deleted" if change.classification == "removed" else "available",
        )

    def _cell_change_matches_filters(
        self,
        bundle: _LayerBundle,
        change: Any,
        filters: BackboneDiffFilters,
    ) -> bool:
        if change.classification == "unchanged" and not filters.include_unchanged:
            return False
        if filters.classification and change.classification not in filters.classification:
            return False
        if filters.parameter_code is not None and change.parameter_code != filters.parameter_code:
            return False
        if filters.category_code is None:
            return True
        return self._parameter_category(
            bundle,
            change.parameter_code,
            baseline=self._change_uses_baseline_authority(
                row_status="removed" if change.classification == "removed" else "matched",
                change=change,
                classification=change.classification,
            ),
        ) == filters.category_code

    def _metadata_matches_filters(self, filters: BackboneDiffFilters) -> bool:
        if filters.category_code is not None or filters.parameter_code is not None:
            return False
        return not filters.classification or "changed" in filters.classification

    def _page_branch_rows(
        self,
        rows: list[BackboneDiffConditionItemOut],
        scope: BackboneDiffBranchScope,
        limit: int,
        cursor: BackboneDiffCursor | None,
    ) -> tuple[list[BackboneDiffConditionItemOut], str | None]:
        items = rows
        if cursor is not None:
            items = [
                item
                for item in items
                if self._row_sort_key(item) > self._branch_cursor_sort_key(cursor)
            ]
        page = items[:limit]
        next_cursor = None
        if len(items) > limit:
            next_cursor = encode_backbone_diff_cursor(
                BackboneDiffCursor(
                    version=1,
                    kind="branch",
                    scope=scope,
                    sort_key=self._row_sort_key(page[-1]),
                )
            )
        return page, next_cursor

    def _page_cell_items(
        self,
        items: list[BackboneDiffCellItemOut],
        scope: BackboneDiffCellScope,
        limit: int,
        cursor: BackboneDiffCursor | None,
    ) -> tuple[list[BackboneDiffCellItemOut], str | None]:
        page_items = items
        if cursor is not None:
            page_items = [
                item
                for item in page_items
                if self._cell_sort_key(item) > self._cell_cursor_sort_key(cursor)
            ]
        page = self._page_cell_items_with_budget(page_items, scope, limit)
        next_cursor = None
        if len(page) < len(page_items):
            next_cursor = encode_backbone_diff_cursor(
                BackboneDiffCursor(
                    version=1,
                    kind="cell",
                    scope=scope,
                    sort_key=self._cell_sort_key(page[-1]),
                )
            )
        return page, next_cursor

    def _page_cell_items_with_budget(
        self,
        items: list[BackboneDiffCellItemOut],
        scope: BackboneDiffCellScope,
        limit: int,
    ) -> list[BackboneDiffCellItemOut]:
        max_items = min(limit, len(items))
        selected: list[BackboneDiffCellItemOut] = []
        for index in range(max_items):
            candidate = selected + [items[index]]
            next_cursor = (
                encode_backbone_diff_cursor(
                    BackboneDiffCursor(
                        version=1,
                        kind="cell",
                        scope=scope,
                        sort_key=self._cell_sort_key(candidate[-1]),
                    )
                )
                if index + 1 < len(items)
                else None
            )
            if (
                self._cell_page_response_size(scope, candidate, next_cursor)
                > _MAX_CELL_RESPONSE_BYTES
            ):
                break
            selected = candidate
        if not selected and items:
            raise ConflictError(
                "backbone diff cell response exceeds the public budget",
                code="response_too_large",
                details={"rule_code": "response_too_large"},
            )
        return selected

    def _cell_page_response_size(
        self,
        scope: BackboneDiffCellScope,
        items: list[BackboneDiffCellItemOut],
        next_cursor: str | None,
    ) -> int:
        payload = {
            "scope": encode_backbone_diff_scope(scope),
            "basis_hash": scope.basis_hash,
            "row_ref": encode_backbone_diff_row_ref(scope.row_ref),
            "items": [item.model_dump(mode="json") for item in items],
            "next_cursor": next_cursor,
        }
        return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    def _find_row(
        self, layer_result: BackboneDiffLayerResult, row_ref: BackboneDiffRowRef
    ) -> BackboneDiffRow:
        for row in layer_result.rows:
            if self._row_ref_for_row(row_ref.project_id, row_ref.layer_key, row) == row_ref:
                return row
        raise RuleViolationError("row_ref does not match available row", code="invalid_row_ref")

    def _row_ref_for_row(
        self, project_id: int, layer_key: str, row: BackboneDiffRow
    ) -> BackboneDiffRowRef:
        if row.row_status == "matched":
            return BackboneDiffRowRef(
                project_id=project_id,
                layer_key=layer_key,
                row_status="matched",
                baseline_condition_id=row.baseline_source_condition_id,
                current_condition_id=row.current_id,
            )
        if row.row_status == "added":
            return BackboneDiffRowRef(
                project_id=project_id,
                layer_key=layer_key,
                row_status="added",
                current_condition_id=row.current_id,
            )
        return BackboneDiffRowRef(
            project_id=project_id,
            layer_key=layer_key,
            row_status="removed",
            baseline_condition_id=row.baseline_source_condition_id,
        )

    def _cell_scope_for_row(
        self,
        project_id: int,
        layer_key: str,
        row: BackboneDiffRow,
        filters: BackboneDiffFilters,
        basis_hash: str,
    ) -> BackboneDiffCellScope:
        return BackboneDiffCellScope(
            project_id=project_id,
            layer_key=layer_key,
            basis_hash=basis_hash,
            row_ref=self._row_ref_for_row(project_id, layer_key, row),
            filters=filters,
        )

    def _baseline_condition_metadata(
        self, row: BackboneDiffRow
    ) -> BackboneDiffConditionMetadataOut | None:
        if row.row_status == "added":
            return None
        source_condition_id = row.baseline_source_condition_id
        if source_condition_id is None:
            return None
        return BackboneDiffConditionMetadataOut(
            condition_id=None,
            source_condition_id=source_condition_id,
            label=row.baseline_label,
            condition_index=row.baseline_condition_index,
            is_por=row.baseline_is_por,
        )

    def _current_condition_metadata(
        self, bundle: _LayerBundle, row: BackboneDiffRow
    ) -> BackboneDiffConditionMetadataOut | None:
        if row.current_id is None:
            return None
        return BackboneDiffConditionMetadataOut(
            condition_id=row.current_id,
            source_condition_id=bundle.current_source_condition_ids.get(row.current_id),
            label=row.current_label,
            condition_index=row.current_condition_index,
            is_por=row.current_is_por,
        )

    def _row_metadata(self, row: BackboneDiffRow) -> BackboneDiffRowMetadataOut:
        changed_fields = {change.field_name for change in row.metadata_changes}
        return BackboneDiffRowMetadataOut(
            label_changed="label" in changed_fields,
            index_changed="condition_index" in changed_fields,
            por_changed="is_por" in changed_fields,
        )

    def _parameter_metadata(
        self,
        bundle: _LayerBundle,
        parameter_code: str,
        *,
        baseline: bool,
        row_status: BackboneDiffRowStatus,
    ) -> BackboneDiffParameterMetadataOut | None:
        if baseline and row_status == "added":
            return None
        if not baseline and row_status == "removed":
            return None
        parameter = self._parameter_for_code(bundle, parameter_code, baseline=baseline)
        if parameter is None:
            return None
        if isinstance(parameter, BackboneDiffCurrentParameter):
            resolved_code = parameter.code
        else:
            resolved_code = parameter.parameter_code
        return BackboneDiffParameterMetadataOut(
            parameter_code=resolved_code,
            value_type=str(getattr(parameter.value_type, "value", parameter.value_type)),
            display_name=parameter.display_name,
            category_code=parameter.category_code,
            sort_order=parameter.sort_order,
            active=getattr(parameter, "active_at_capture", getattr(parameter, "active", False)),
        )

    def _parameter_for_code(
        self,
        bundle: _LayerBundle,
        parameter_code: str,
        *,
        baseline: bool,
    ) -> BackboneDiffCurrentParameter | BackboneSnapshotColumn | None:
        if baseline:
            return bundle.baseline_columns_by_code.get(parameter_code)
        return bundle.selected_current_parameters_by_code.get(parameter_code)

    def _parameter_category(
        self, bundle: _LayerBundle, parameter_code: str, *, baseline: bool
    ) -> str | None:
        parameter = self._parameter_for_code(bundle, parameter_code, baseline=baseline)
        if parameter is None:
            raise RuleViolationError(
                f"missing descriptor for parameter {parameter_code}",
                code="unresolved_parameter_metadata",
            )
        return parameter.category_code

    def _require_public_cell_value(self, raw: Any) -> str | None:
        if raw is None:
            return None
        if not isinstance(raw, str) or len(raw) > _MAX_PUBLIC_CELL_VALUE_LENGTH:
            raise ConflictError(
                "backbone diff value exceeds the public contract",
                code="value_too_long",
                details={"rule_code": "value_too_long"},
            )
        return raw

    def _change_uses_baseline_authority(
        self,
        row_status: BackboneDiffRowStatus,
        change: Any | None,
        *,
        classification: BackboneDiffClassification | None = None,
    ) -> bool:
        if row_status == "removed":
            return True
        if change is not None and getattr(change, "reason", None) in {
            "column_removed",
            "row_removed",
        }:
            return True
        return classification == "removed"

    def _row_key(self, row: BackboneDiffRow) -> tuple[str, int]:
        return (row.row_status, row.identity)

    def _row_sort_key(self, item: BackboneDiffConditionItemOut) -> tuple[int, int, int]:
        return (item.effective_condition_index, _ROW_STATUS_RANK[item.row_status], item.identity)

    def _branch_cursor_sort_key(self, cursor: BackboneDiffCursor) -> tuple[int, int, int]:
        if len(cursor.sort_key) != 3:
            raise RuleViolationError("branch cursor sort key is invalid", code="invalid_cursor")
        first, second, third = cursor.sort_key
        if type(first) is not int or type(second) is not int or type(third) is not int:
            raise RuleViolationError("branch cursor sort key is invalid", code="invalid_cursor")
        if first < 0 or not 0 <= second <= 2 or third <= 0:
            raise RuleViolationError("branch cursor sort key is invalid", code="invalid_cursor")
        return cast(tuple[int, int, int], cursor.sort_key)

    def _cell_sort_key(self, item: BackboneDiffCellItemOut) -> tuple[int, str]:
        return (item.parameter_sort, item.parameter_code)

    def _cell_cursor_sort_key(self, cursor: BackboneDiffCursor) -> tuple[int, str]:
        if len(cursor.sort_key) != 2:
            raise RuleViolationError("cell cursor sort key is invalid", code="invalid_cursor")
        first, second = cursor.sort_key
        if type(first) is not int or type(second) is not str:
            raise RuleViolationError("cell cursor sort key is invalid", code="invalid_cursor")
        if first < 0 or not second:
            raise RuleViolationError("cell cursor sort key is invalid", code="invalid_cursor")
        return cast(tuple[int, str], cursor.sort_key)

def build_backbone_diff_provider(session: AsyncSession) -> BackboneDiffProvider:
    bind = session.bind
    if bind is None:
        raise RuntimeError("backbone diff provider requires a bound async session")
    if isinstance(bind, AsyncEngine):
        engine = bind
    elif isinstance(bind, AsyncConnection):
        engine = bind.engine
    else:
        raise RuntimeError("backbone diff provider requires an async engine or connection")
    factory = build_read_only_sessionmaker(engine)
    return BackboneDiffProvider(factory)


__all__ = ["BackboneDiffProvider", "build_backbone_diff_provider"]
