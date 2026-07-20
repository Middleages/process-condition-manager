"""Phase 5 approval workflow orchestration."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from app.core.auth import Permission, PermissionDeniedError, Role, UserContext
from app.core.errors import AppError, NotFoundError
from app.core.locks import utcnow
from app.domain.errors import RuleViolationError
from app.domain.parameters.definition_view import DefinitionView
from app.domain.parameters.snapshot import snapshot as build_parameter_snapshot
from app.domain.parameters.types import ValueType
from app.domain.validation import evaluate_project
from app.domain.workflow import (
    ProjectStatus,
    ReviewTransition,
    WorkflowRuleError,
    apply_review_transition,
    assert_comment_target,
    compute_revision_proposal,
)
from app.features.approval.repository import ApprovalRepository
from app.features.approval.schema import ReviewAction
from app.features.sheets.repository import SheetRepository
from app.features.validation.project_service import (
    CanonicalValidationBasis,
    CanonicalValidationBasisLoader,
)
from app.models.project import (
    CellValue,
    ChangeEvent,
    ChangeEventType,
    LayerCondition,
    Project,
    ProjectProfile,
    ReviewComment,
    SheetLayer,
)


class ApprovalRequestError(AppError):
    def __init__(
        self,
        message: str,
        *,
        code: str,
        details: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message, code=code, status_code=409, details=details or {})


class ApprovalValidationError(AppError):
    def __init__(
        self,
        message: str,
        *,
        code: str,
        details: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message, code=code, status_code=422, details=details or {})


class ApprovalService:
    def __init__(self, repo: ApprovalRepository) -> None:
        self.repo = repo
        self.basis_loader = CanonicalValidationBasisLoader(SheetRepository(repo.session))

    async def list_comments(
        self,
        project_id: int,
        *,
        before_id: int | None,
        condition_id: int | None,
        layer_key: str | None,
        parameter_code: str | None,
        resolved: str,
        target: str,
        limit: int,
    ) -> tuple[list[ReviewComment], int | None]:
        if not await self.repo.project_exists(project_id):
            raise NotFoundError(f"프로젝트를 찾을 수 없다: {project_id}")
        comments, has_more = await self.repo.list_comments(
            project_id,
            before_id=before_id,
            condition_id=condition_id,
            layer_key=layer_key,
            parameter_code=parameter_code,
            resolved=resolved,
            target=target,
            limit=limit,
        )
        next_cursor: int | None = comments[-1].id if has_more and comments else None
        return list(comments), next_cursor

    async def create_comment(
        self,
        project_id: int,
        *,
        body: str,
        actor: str,
        condition_id: int | None,
        layer_key: str | None,
        parameter_code: str | None,
    ) -> ReviewComment:
        project = await self._ensure_project_for_update(project_id)
        await self._assert_comment_scope(project, condition_id, layer_key, parameter_code)

        normalized = body.replace("\r\n", "\n").strip()
        if not normalized:
            raise ApprovalValidationError("댓글 본문이 비어있습니다", code="invalid_comment_body")
        if len(normalized) > 4000:
            raise ApprovalValidationError("댓글 본문이 너무 깁니다", code="invalid_comment_body")

        comment = ReviewComment(
            project_id=project_id,
            condition_id=condition_id,
            layer_key=layer_key,
            parameter_code=parameter_code,
            body=normalized,
            author=actor,
            resolved=False,
            resolved_by=None,
            resolved_at=None,
            deleted=False,
            deleted_by=None,
            deleted_at=None,
        )
        await self.repo.add_comment(comment)
        await self.repo.session.flush()
        await self.repo.add_event(
            self._comment_event(
                operation_id=str(uuid.uuid4()),
                project_id=project_id,
                actor=actor,
                comment=comment,
                action="create",
                from_resolved=False,
                to_resolved=False,
                deleted=False,
            )
        )
        return comment

    async def set_comment_resolved(
        self,
        project_id: int,
        comment_id: int,
        actor: str,
        *,
        resolved: bool,
    ) -> ReviewComment:
        await self._ensure_project_for_update(project_id)
        comment = await self._load_comment_for_update(project_id, comment_id)
        if comment.deleted:
            raise ApprovalRequestError(
                "삭제된 댓글은 상태를 바꿀 수 없습니다", code="comment_deleted"
            )

        prev = comment.resolved
        if prev == resolved:
            return comment

        now = utcnow()
        comment.resolved = resolved
        comment.resolved_by = actor if resolved else None
        comment.resolved_at = now if resolved else None
        comment.updated_at = now
        await self.repo.add_event(
            self._comment_event(
                operation_id=str(uuid.uuid4()),
                project_id=project_id,
                actor=actor,
                comment=comment,
                action="resolve" if resolved else "unresolve",
                from_resolved=prev,
                to_resolved=resolved,
                deleted=comment.deleted,
            )
        )
        return comment

    async def delete_comment(
        self,
        project_id: int,
        comment_id: int,
        actor: str,
        user: UserContext,
    ) -> None:
        await self._ensure_project_for_update(project_id)
        comment = await self._load_comment_for_update(project_id, comment_id)
        if not self._can_delete_comment(comment, user):
            raise PermissionDeniedError("댓글 삭제 권한이 없습니다")
        if comment.deleted:
            raise ApprovalRequestError(
                "이미 삭제된 댓글입니다",
                code="comment_deleted",
            )

        now = utcnow()
        comment.deleted = True
        comment.deleted_by = actor
        comment.deleted_at = now
        comment.updated_at = now
        await self.repo.add_event(
            self._comment_event(
                operation_id=str(uuid.uuid4()),
                project_id=project_id,
                actor=actor,
                comment=comment,
                action="delete",
                from_resolved=comment.resolved,
                to_resolved=comment.resolved,
                deleted=True,
            )
        )

    async def transition_project(
        self,
        project_id: int,
        action: ReviewAction,
        actor: str,
        *,
        expected_status: ProjectStatus | None = None,
    ) -> tuple[Project, str, bool]:
        await self.repo.begin_consistent_transition()
        project = await self._ensure_project_for_update(project_id)
        if expected_status is not None and project.status != expected_status:
            raise ApprovalRequestError(
                "요청 상태가 현재 상태와 다릅니다",
                code="workflow_status_conflict",
                details={
                    "expected_status": expected_status.value,
                    "actual_status": project.status.value,
                },
            )

        transition = {
            "request_review": ReviewTransition.REQUEST_REVIEW,
            "approve": ReviewTransition.APPROVE,
            "reject": ReviewTransition.REJECT,
            "return_to_draft": ReviewTransition.RETURN_TO_DRAFT,
        }[action]
        try:
            next_status, _ = apply_review_transition(
                status=project.status,
                transition=transition,
            )
        except WorkflowRuleError as exc:
            raise ApprovalRequestError(
                exc.message,
                code=exc.code,
                details=exc.details or {},
            ) from exc

        operation_id = str(uuid.uuid4())
        revalidated = False
        from_status = project.status

        if action == "request_review":
            basis = await self.basis_loader.load(project_id)
            result = self._evaluate_basis(basis)
            self._assert_request_review_gate(project, basis=basis, result=result)
            captured_basis = await self._snapshot_basis(basis)
            project.status = next_status
            project.review_basis_hash = str(captured_basis["validation_basis_hash"])
            project.review_rule_versions = self._rule_versions(basis)
            await self.repo.clear_lock(project_id)
        elif action == "approve":
            if project.review_basis_hash is None:
                # deterministic failure for missing evidence
                raise ApprovalRequestError(
                    "승인 증거가 없어 승인할 수 없습니다",
                    code="review_gate_failed",
                )
            basis = await self.basis_loader.load(project_id)
            captured_basis = await self._snapshot_basis(basis)
            captured_hash = str(captured_basis["validation_basis_hash"])
            revalidated = captured_hash != project.review_basis_hash
            if revalidated:
                self._assert_validation_gate(basis, self._evaluate_basis(basis))
            project.parameter_snapshot = captured_basis
            project.review_basis_hash = captured_hash
            project.review_rule_versions = self._rule_versions(basis)
            project.status = next_status
        elif action == "reject":
            project.status = next_status
        elif action == "return_to_draft":
            project.status = next_status
            project.review_basis_hash = None
            project.review_rule_versions = None

        await self.repo.add_event(
            ChangeEvent(
                project_id=project_id,
                event_type=ChangeEventType.STATUS_CHANGE,
                actor=actor,
                payload={
                    "schema_version": 1,
                    "operation_id": operation_id,
                    "action": action,
                    "from_status": from_status.value,
                    "to_status": project.status.value,
                    "basis_hash": project.review_basis_hash,
                    "rule_versions": project.review_rule_versions,
                    "revalidated": revalidated,
                },
                condition_id=None,
                parameter_code=None,
                layer_key=None,
                origin="manual",
                source_project_id=None,
                source_layer_key=None,
                old_value=from_status.value,
                new_value=project.status.value,
            )
        )
        return project, operation_id, revalidated

    async def create_revision(self, project_id: int, actor: str) -> tuple[Project, Project, str]:
        await self.repo.begin_consistent_transition()
        candidate = await self._ensure_project_exists(project_id)
        root_id = candidate.revision_root_id or candidate.id
        locked = await self.repo.get_revision_projects_for_update(project_id, root_id)
        source = next((project for project in locked if project.id == project_id), None)
        if source is None:
            raise NotFoundError(f"프로젝트를 찾을 수 없다: {project_id}")
        if source.status != ProjectStatus.APPROVED:
            raise ApprovalRequestError(
                "승인된 프로젝트만 개정할 수 있습니다",
                code="workflow_transition_invalid",
                details={
                    "from": source.status.value,
                    "transition": "create_revision",
                    "allowed": [],
                },
            )

        if await self.repo.has_successor(project_id):
            raise ApprovalRequestError(
                "이미 개정본이 존재합니다",
                code="revision_exists",
            )

        proposal = compute_revision_proposal(
            project_id=source.id,
            revision_root_id=source.revision_root_id,
            revision_of_id=source.revision_of_id,
            version=source.version,
            status=source.status,
        )

        operation_id = str(uuid.uuid4())
        source.status = ProjectStatus.ARCHIVED
        source.updated_at = utcnow()
        source_version = source.version
        await self.repo.clear_lock(project_id)
        await self.repo.session.flush()

        source_profile = source.profile
        target_profile = ProjectProfile(
            process_name=source_profile.process_name,
            device_type_code=source_profile.device_type_code,
            project_category_code=source_profile.project_category_code,
            comment=source_profile.comment,
            active_direction_code=source_profile.active_direction_code,
            gate_direction_code=source_profile.gate_direction_code,
            gross_die=source_profile.gross_die,
            pitch_x=source_profile.pitch_x,
            pitch_y=source_profile.pitch_y,
            shot_x=source_profile.shot_x,
            shot_y=source_profile.shot_y,
            slit_occupancy=source_profile.slit_occupancy,
            lens_occupancy=source_profile.lens_occupancy,
            map_offset_x=source_profile.map_offset_x,
            map_offset_y=source_profile.map_offset_y,
            scribe_lane_x=source_profile.scribe_lane_x,
            scribe_lane_y=source_profile.scribe_lane_y,
            shot_count=source_profile.shot_count,
            full_shot=source_profile.full_shot,
            layer_total=source_profile.layer_total,
            euv=source_profile.euv,
            imm=source_profile.imm,
            arf=source_profile.arf,
            krf=source_profile.krf,
            iline=source_profile.iline,
            soh=source_profile.soh,
            pspi=source_profile.pspi,
            metal_layer_count=source_profile.metal_layer_count,
        )
        target = Project(
            line_id=source.line_id,
            process_id=source.process_id,
            part_id=source.part_id,
            name=source.name,
            status=ProjectStatus.DRAFT,
            version=proposal.version,
            revision_root_id=proposal.revision_root_id,
            revision_of_id=proposal.revision_of_id,
            parameter_snapshot=None,
            review_basis_hash=None,
            review_rule_versions=None,
            profile=target_profile,
        )
        self.repo.session.add(target)

        for source_layer in source.layers:
            target_layer = SheetLayer(
                layer_key=source_layer.layer_key,
                step_seq=source_layer.step_seq,
                layer_id=source_layer.layer_id,
                eqp_type=source_layer.eqp_type,
                eqp_type_desc=source_layer.eqp_type_desc,
                area_name=source_layer.area_name,
                sort_order=source_layer.sort_order,
                source_project_id=source_layer.source_project_id,
                source_layer_key=source_layer.source_layer_key,
                backbone_snapshot=source_layer.backbone_snapshot,
            )
            target.layers.append(target_layer)
            for source_condition in source_layer.conditions:
                target_condition = LayerCondition(
                    label=source_condition.label,
                    condition_index=source_condition.condition_index,
                    is_por=source_condition.is_por,
                    source_condition_id=source_condition.source_condition_id,
                )
                target_layer.conditions.append(target_condition)
                for source_cell in source_condition.cell_values:
                    target_condition.cell_values.append(
                        CellValue(
                            parameter_code=source_cell.parameter_code,
                            value_text=source_cell.value_text,
                        )
                    )

        # One dependency-ordered flush lets SQLAlchemy batch the complete graph;
        # mutation round trips no longer grow with layer/condition count.
        await self.repo.session.flush()

        source_payload = {
            "schema_version": 1,
            "operation_id": operation_id,
            "source_project_id": source.id,
            "target_project_id": target.id,
            "source_version": source_version,
            "target_version": target.version,
            "event_role": "source",
        }
        self.repo.session.add(
            ChangeEvent(
                project_id=source.id,
                event_type=ChangeEventType.REVISION_CREATE,
                actor=actor,
                payload=source_payload,
                origin="manual",
                condition_id=None,
                parameter_code=None,
                layer_key=None,
                source_project_id=source.id,
                source_layer_key=None,
            )
        )
        target_payload = dict(source_payload, event_role="target")
        self.repo.session.add(
            ChangeEvent(
                project_id=target.id,
                event_type=ChangeEventType.REVISION_CREATE,
                actor=actor,
                payload=target_payload,
                origin="manual",
                condition_id=None,
                parameter_code=None,
                layer_key=None,
                source_project_id=source.id,
                source_layer_key=None,
            )
        )

        await self.repo.session.flush()
        loaded_target = await self.repo.get_project(target.id)
        assert loaded_target is not None
        return source, loaded_target, operation_id

    async def _ensure_project_exists(self, project_id: int) -> Project:
        project = await self.repo.get_project(project_id)
        if project is None:
            raise NotFoundError(f"프로젝트를 찾을 수 없다: {project_id}")
        return project

    async def _ensure_project_for_update(self, project_id: int) -> Project:
        project = await self.repo.get_project_for_update(project_id)
        if project is None:
            raise NotFoundError(f"프로젝트를 찾을 수 없다: {project_id}")
        return project

    async def _load_comment(self, project_id: int, comment_id: int) -> ReviewComment:
        comment = await self.repo.get_comment(project_id, comment_id)
        if comment is None:
            raise NotFoundError(f"댓글을 찾을 수 없다: {comment_id}")
        return comment

    async def _load_comment_for_update(
        self,
        project_id: int,
        comment_id: int,
    ) -> ReviewComment:
        comment = await self.repo.get_comment_for_update(project_id, comment_id)
        if comment is None:
            raise NotFoundError(f"댓글을 찾을 수 없다: {comment_id}")
        return comment

    async def _assert_comment_scope(
        self,
        project: Project,
        condition_id: int | None,
        layer_key: str | None,
        parameter_code: str | None,
    ) -> None:
        assert_comment_target(
            condition_id=condition_id,
            layer_key=layer_key,
            parameter_code=parameter_code,
        )
        if condition_id is None:
            return
        condition = await self.repo.get_condition_in_project(project.id, condition_id)
        if condition is None or condition.layer.layer_key != layer_key:
            raise ApprovalValidationError(
                "프로젝트 내 조건/레이어가 일치하지 않습니다",
                code="comment_target_not_found",
                details={"project_id": project.id, "condition_id": condition_id},
            )
        if parameter_code is None:
            return
        if not any(cell.parameter_code == parameter_code for cell in condition.cell_values):
            if project.status in {ProjectStatus.APPROVED, ProjectStatus.ARCHIVED}:
                known = parameter_code in {
                    str(column.get("code"))
                    for column in DefinitionView.from_snapshot(project.parameter_snapshot).columns()
                }
            else:
                known = await self.repo.has_layer_param_code(parameter_code)
            if not known:
                raise ApprovalValidationError(
                    "존재하지 않는 셀 좌표입니다",
                    code="invalid_comment_parameter",
                    details={"parameter_code": parameter_code},
                )

    def _assert_request_review_gate(
        self,
        project: Project,
        *,
        basis: CanonicalValidationBasis,
        result: Any,
    ) -> None:
        missing: list[dict[str, str | int]] = []
        for layer in sorted(project.layers, key=lambda layer: (layer.sort_order, layer.layer_key)):
            por_count = sum(1 for condition in layer.conditions if condition.is_por)
            if por_count != 1:
                missing.append({"layer_key": layer.layer_key, "layer_label": str(layer.layer_id)})
        if missing or result.error_count:
            bounded_missing = _bounded_json_items(missing, max_items=200, byte_budget=64 * 1024)
            details = {
                "validation": self._validation_details(basis, result),
                "missing_por_layers": bounded_missing,
                "total_missing_por_count": len(missing),
            }
            _fit_review_gate_details(details)
            raise ApprovalRequestError(
                "Review 게이트 검증에 실패했습니다",
                code="review_gate_failed",
                details=details,
            )

    def _assert_validation_gate(self, basis: CanonicalValidationBasis, result: Any) -> None:
        if result.error_count:
            details = {
                "validation": self._validation_details(basis, result),
                "missing_por_layers": [],
                "total_missing_por_count": 0,
            }
            _fit_review_gate_details(details)
            raise ApprovalRequestError(
                "Approval 게이트 검증에 실패했습니다",
                code="review_gate_failed",
                details=details,
            )

    def _can_delete_comment(self, comment: ReviewComment, user: UserContext) -> bool:
        if comment.author == user.id:
            return True
        if Role.ADMIN in user.roles:
            return True
        return False

    @staticmethod
    def _evaluate_basis(basis: CanonicalValidationBasis) -> Any:
        try:
            return evaluate_project(
                basis.context,
                basis.parameter_definitions,
                basis.layers,
                tuple(rule.definition for rule in basis.rules),
            )
        except (RuleViolationError, TypeError, ValueError) as exc:
            raise ApprovalValidationError(
                "검증 구성이 올바르지 않습니다",
                code="validation_configuration_invalid",
            ) from exc

    @staticmethod
    def _rule_versions(basis: CanonicalValidationBasis) -> dict[str, int]:
        return {
            rule.definition.code: rule.definition.version
            for rule in sorted(basis.rules, key=lambda item: item.definition.code)
        }

    def _validation_details(self, basis: CanonicalValidationBasis, result: Any) -> dict[str, Any]:
        issues = [issue.to_dict() for issue in result.issues]
        selected: list[dict[str, Any]] = []
        # Reserve room for the AppError envelope, summary, rules and up to 200
        # missing-POR coordinates. This keeps the complete 409 body below the
        # PRD's 256 KiB ceiling even with multi-byte Unicode literals.
        selected = _bounded_json_items(issues, max_items=200, byte_budget=144 * 1024)
        return {
            "summary": {
                "error_count": result.error_count,
                "warning_count": result.warning_count,
            },
            "issues": selected,
            "evaluated_at": datetime.now(UTC).isoformat(),
            "basis_hash": basis.basis_hash,
            "rule_versions": self._rule_versions(basis),
            "truncated": len(selected) < len(issues),
        }

    async def _snapshot_basis(self, basis: CanonicalValidationBasis) -> dict[str, Any]:
        categories = await self.repo.list_active_categories()
        choice_sets = await self.repo.list_choice_sets()
        return build_parameter_snapshot(
            categories=(
                {
                    "code": category.code,
                    "display_name": category.display_name,
                    "sort_order": category.sort_order,
                    "is_active": category.is_active,
                }
                for category in categories
            ),
            parameters=(
                {
                    "code": parameter.code,
                    "display_name": parameter.display_name,
                    "description": parameter.description,
                    "value_type": parameter.value_type,
                    "category_code": (
                        basis.category_code_by_id.get(parameter.category_id)
                        if parameter.category_id is not None
                        else None
                    ),
                    "choice_set_code": (
                        parameter.choice_set.code
                        if parameter.value_type is ValueType.CHOICE
                        and parameter.choice_set is not None
                        else None
                    ),
                    "unit": (
                        parameter.unit if parameter.value_type is ValueType.NUMBER else None
                    ),
                    "min_value": (
                        format(parameter.min_value, "f")
                        if parameter.value_type is ValueType.NUMBER
                        and parameter.min_value is not None
                        else None
                    ),
                    "max_value": (
                        format(parameter.max_value, "f")
                        if parameter.value_type is ValueType.NUMBER
                        and parameter.max_value is not None
                        else None
                    ),
                    "required": parameter.required,
                    "pattern": (
                        parameter.pattern if parameter.value_type is ValueType.TEXT else None
                    ),
                    "pattern_hint": (
                        parameter.pattern_hint
                        if parameter.value_type is ValueType.TEXT
                        else None
                    ),
                    "sort_order": parameter.sort_order,
                    "is_active": parameter.is_active,
                }
                for parameter in basis.parameters
            ),
            choice_sets=(
                {
                    "code": choice_set.code,
                    "display_name": choice_set.display_name,
                    "version": choice_set.version,
                    "is_active": choice_set.is_active,
                    "options": [
                        {
                            "code": option.code,
                            "label": option.label,
                            "sort_order": option.sort_order,
                            "is_active": option.is_active,
                        }
                        for option in choice_set.options
                    ],
                }
                for choice_set in choice_sets
            ),
            validation_rules=(rule.definition for rule in basis.rules),
        )

    def _comment_event(
        self,
        *,
        operation_id: str,
        project_id: int,
        actor: str,
        comment: ReviewComment,
        action: str,
        from_resolved: bool,
        to_resolved: bool,
        deleted: bool,
    ) -> ChangeEvent:
        return ChangeEvent(
            project_id=project_id,
            event_type=ChangeEventType.COMMENT,
            actor=actor,
            payload={
                "schema_version": 1,
                "operation_id": operation_id,
                "comment_id": comment.id,
                "target": {
                    "layer_key": comment.layer_key,
                    "condition_id": comment.condition_id,
                    "parameter_code": comment.parameter_code,
                },
                "action": action,
                "from_resolved": from_resolved,
                "to_resolved": to_resolved,
                "deleted": deleted,
            },
            condition_id=comment.condition_id,
            parameter_code=comment.parameter_code,
            layer_key=comment.layer_key,
            origin="manual",
            source_project_id=None,
            source_layer_key=None,
        )


def _bounded_json_items(
    items: list[dict[str, Any]], *, max_items: int, byte_budget: int
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    used = 2
    for item in items[:max_items]:
        encoded_size = len(
            json.dumps(item, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ) + 1
        if used + encoded_size > byte_budget:
            break
        selected.append(item)
        used += encoded_size
    return selected


def _fit_review_gate_details(details: dict[str, Any]) -> None:
    """Mutate gate details to leave deterministic room for the public error envelope."""
    byte_budget = 240 * 1024
    validation = details["validation"]
    assert isinstance(validation, dict)
    issues = validation["issues"]
    rule_versions = validation["rule_versions"]
    missing = details["missing_por_layers"]
    assert isinstance(issues, list)
    assert isinstance(rule_versions, dict)
    assert isinstance(missing, list)

    current_size = _json_size(details)
    while current_size > byte_budget:
        validation["truncated"] = True
        if rule_versions:
            key = next(reversed(rule_versions))
            value = rule_versions.pop(key)
            current_size -= _json_size({key: value}) - 1
        elif issues:
            current_size -= _json_size(issues.pop()) + 1
        elif missing:
            current_size -= _json_size(missing.pop()) + 1
        else:  # fixed fields are far below the budget
            raise AssertionError("review gate fixed payload exceeds byte budget")

    # The arithmetic above deliberately overestimates comma/bracket savings;
    # assert against the actual final serialization as the contract boundary.
    assert _json_size(details) <= byte_budget


def _json_size(value: object) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def allowed_actions_for_user(
    project_status: ProjectStatus,
    *,
    permissions: tuple[Permission, ...],
) -> list[str]:
    can_request = Permission.PROJECT_REVIEW_REQUEST in permissions
    can_decide = Permission.PROJECT_REVIEW_DECIDE in permissions
    can_revision = Permission.PROJECT_REVISION_CREATE in permissions
    actions: list[str] = []
    if project_status == ProjectStatus.DRAFT and can_request:
        actions.append("request_review")
    if project_status == ProjectStatus.REVIEW and can_decide:
        actions.extend(("approve", "reject"))
    if project_status == ProjectStatus.REJECTED and can_request:
        actions.append("return_to_draft")
    if project_status == ProjectStatus.APPROVED and can_revision:
        actions.append("create_revision")
    return actions
