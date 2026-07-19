"""순수 리뷰/개정 규칙 (프레임워크 무의존)."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from app.domain.errors import RuleViolationError


class ProjectStatus(StrEnum):
    """프로젝트 상태 값."""

    DRAFT = "draft"
    REVIEW = "review"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class ReviewTransition(StrEnum):
    """리뷰 상태 전이 이벤트."""

    REQUEST_REVIEW = "request_review"
    APPROVE = "approve"
    REJECT = "reject"
    RETURN_TO_DRAFT = "return_to_draft"


class ProjectTransition(StrEnum):
    """프로젝트 상태 전이 엔트리."""

    DRAFT_TO_REVIEW = "draft_to_review"
    REVIEW_TO_APPROVED = "review_to_approved"
    REVIEW_TO_REJECTED = "review_to_rejected"
    REJECTED_TO_DRAFT = "rejected_to_draft"


class CommentScope(StrEnum):
    """댓글 대상 범위."""

    PROJECT = "project"
    CELL = "cell"


class MutationBlockReason(StrEnum):
    """쓰기 제한 사유."""

    LOCKED = "locked"
    ARCHIVED = "archived"


class WorkflowRuleError(RuleViolationError):
    """리뷰/개정 규칙 위반."""


class RevisionProposalError(RuleViolationError):
    """개정본 생성 규칙 위반."""


_TRANSITION_RULES: dict[
    ProjectStatus, dict[ReviewTransition, tuple[ProjectStatus, ProjectTransition]]
] = {
    ProjectStatus.DRAFT: {
        ReviewTransition.REQUEST_REVIEW: (
            ProjectStatus.REVIEW,
            ProjectTransition.DRAFT_TO_REVIEW,
        )
    },
    ProjectStatus.REVIEW: {
        ReviewTransition.APPROVE: (
            ProjectStatus.APPROVED,
            ProjectTransition.REVIEW_TO_APPROVED,
        ),
        ReviewTransition.REJECT: (
            ProjectStatus.REJECTED,
            ProjectTransition.REVIEW_TO_REJECTED,
        ),
    },
    ProjectStatus.REJECTED: {
        ReviewTransition.RETURN_TO_DRAFT: (
            ProjectStatus.DRAFT,
            ProjectTransition.REJECTED_TO_DRAFT,
        ),
    },
}


def apply_review_transition(
    *, status: ProjectStatus, transition: ReviewTransition
) -> tuple[ProjectStatus, ProjectTransition]:
    """리뷰 상태 전이를 결정한다.

    Returns:
        (next_status, transition)

    Raises:
        WorkflowRuleError: 유효하지 않은 전이 요청.
    """

    transitions = _TRANSITION_RULES.get(status)
    if transitions is None or transition not in transitions:
        allowed = sorted(transitions.keys()) if transitions is not None else []
        raise WorkflowRuleError(
            f"허용되지 않는 상태 전이: {status.value} -> {transition.value}",
            code="workflow_transition_invalid",
            details={"from": status.value, "transition": transition.value, "allowed": allowed},
        )

    return transitions[transition]


@dataclass(frozen=True, slots=True)
class RevisionProposal:
    """개정본 생성 시 선계산되는 lineage 메타데이터."""

    revision_root_id: int
    revision_of_id: int
    version: int


def compute_revision_proposal(
    *,
    project_id: int,
    revision_root_id: int | None,
    revision_of_id: int | None,
    version: int,
    status: ProjectStatus,
) -> RevisionProposal:
    """다음 개정본을 위한 lineage 제약값을 계산한다.

    Args:
        project_id: 개정 원본 프로젝트 ID.
        revision_root_id: 현재 루트 체인 ID. 없으면 자기 자신이 루트로 간주.
        revision_of_id: 현재 상위 개정 원본 ID. 있으면 이미 유효성 선점 체크.
        version: 현재 버전.
        status: 현재 상태.
    """

    if status is not ProjectStatus.APPROVED:
        raise RevisionProposalError(
            "승인된 프로젝트만 개정본을 생성할 수 있다.",
            code="revision_status_must_be_approved",
            details={"status": status.value},
        )
    if revision_of_id is not None and revision_of_id == project_id:
        raise RevisionProposalError(
            "순환 개정 링크는 허용되지 않는다.",
            code="revision_circular_reference",
        )
    if version < 1:
        raise RevisionProposalError(
            "버전은 1 이상이어야 한다.",
            code="invalid_version_state",
            details={"version": version},
        )

    if version == 1:
        if revision_of_id is not None or revision_root_id not in {None, project_id}:
            raise RevisionProposalError(
                "초기 버전의 lineage가 올바르지 않다.",
                code="invalid_revision_lineage",
            )
    elif (
        revision_root_id is None
        or revision_root_id == project_id
        or revision_of_id is None
        or revision_of_id == project_id
    ):
        raise RevisionProposalError(
            "개정 버전의 lineage가 올바르지 않다.",
            code="invalid_revision_lineage",
        )

    root_id = revision_root_id if revision_root_id is not None else project_id
    return RevisionProposal(
        revision_root_id=root_id,
        revision_of_id=project_id,
        version=version + 1,
    )


def assert_project_mutable_for_editor(status: ProjectStatus) -> None:
    """편집이 허용되는 상태를 검증한다."""

    if status is not ProjectStatus.DRAFT:
        raise WorkflowRuleError(
            "읽기 전용 상태의 프로젝트는 편집할 수 없다",
            code="project_read_only",
            details={"status": status.value},
        )


def assert_comment_target(
    *,
    condition_id: int | None,
    layer_key: str | None,
    parameter_code: str | None,
) -> CommentScope:
    """프로젝트 댓글 대상이 프로젝트 단위인지 셀 단위인지 판정한다."""

    project_scope = (
        condition_id is None and layer_key is None and parameter_code is None
    )
    cell_scope = (
        condition_id is not None
        and layer_key is not None
        and parameter_code is not None
    )
    if project_scope:
        return CommentScope.PROJECT
    if cell_scope:
        return CommentScope.CELL
    raise WorkflowRuleError(
        "댓글 대상은 project 단위 또는 cell 단위 중 하나여야 한다.",
        code="invalid_comment_target",
        details={
            "condition_id": condition_id,
            "layer_key": layer_key,
            "parameter_code": parameter_code,
        },
    )
