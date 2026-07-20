from app.domain.workflow import (
    CommentScope,
    ProjectStatus,
    ProjectTransition,
    ReviewTransition,
    RevisionProposal,
    RevisionProposalError,
    WorkflowRuleError,
    apply_review_transition,
    assert_comment_target,
    assert_project_mutable_for_editor,
    compute_revision_proposal,
)


def test_review_transition_uses_the_contract_matrix() -> None:
    assert apply_review_transition(
        status=ProjectStatus.DRAFT,
        transition=ReviewTransition.REQUEST_REVIEW,
    ) == (ProjectStatus.REVIEW, ProjectTransition.DRAFT_TO_REVIEW)

    assert apply_review_transition(
        status=ProjectStatus.REVIEW,
        transition=ReviewTransition.APPROVE,
    ) == (ProjectStatus.APPROVED, ProjectTransition.REVIEW_TO_APPROVED)

    assert apply_review_transition(
        status=ProjectStatus.REVIEW,
        transition=ReviewTransition.REJECT,
    ) == (ProjectStatus.REJECTED, ProjectTransition.REVIEW_TO_REJECTED)

    assert apply_review_transition(
        status=ProjectStatus.REJECTED,
        transition=ReviewTransition.RETURN_TO_DRAFT,
    ) == (
        ProjectStatus.DRAFT,
        ProjectTransition.REJECTED_TO_DRAFT,
    )


def test_review_transition_rejects_disallowed_actions() -> None:
    try:
        apply_review_transition(
            status=ProjectStatus.APPROVED,
            transition=ReviewTransition.APPROVE,
        )
    except WorkflowRuleError as exc:
        assert exc.code == "workflow_transition_invalid"
        assert exc.details is not None
    else:
        raise AssertionError("approved project should not accept transition")

    try:
        apply_review_transition(
        status=ProjectStatus.DRAFT,
        transition=ReviewTransition.RETURN_TO_DRAFT,
    )
    except WorkflowRuleError as exc:
        assert exc.code == "workflow_transition_invalid"
        assert exc.details is not None
    else:
        raise AssertionError("draft project should not accept return_to_draft")


def test_comment_target_is_exclusive_project_or_cell_scope() -> None:
    assert (
        assert_comment_target(condition_id=None, layer_key=None, parameter_code=None)
        == CommentScope.PROJECT
    )
    assert (
        assert_comment_target(
            condition_id=7,
            layer_key="L1",
            parameter_code="p1",
        )
        == CommentScope.CELL
    )

    for payload in (
        {"condition_id": 7, "layer_key": None, "parameter_code": "p1"},
        {"condition_id": None, "layer_key": "L1", "parameter_code": "p1"},
        {"condition_id": 7, "layer_key": "L1", "parameter_code": None},
    ):
        try:
            assert_comment_target(**payload)
        except WorkflowRuleError as exc:
            assert exc.code == "invalid_comment_target"
        else:
            raise AssertionError(f"partial scope must fail: {payload}")


def test_mutability_guard_only_allows_draft() -> None:
    assert_project_mutable_for_editor(ProjectStatus.DRAFT)
    for status in (
        ProjectStatus.REVIEW,
        ProjectStatus.REJECTED,
        ProjectStatus.APPROVED,
        ProjectStatus.ARCHIVED,
    ):
        try:
            assert_project_mutable_for_editor(status)
        except WorkflowRuleError as exc:
            assert exc.code == "project_read_only"
        else:
            raise AssertionError(f"status {status.value} should be blocked")


def test_revision_proposal_advances_version_and_reuses_root_chain() -> None:
    first = compute_revision_proposal(
        project_id=100,
        revision_root_id=None,
        revision_of_id=None,
        version=1,
        status=ProjectStatus.APPROVED,
    )
    assert first == RevisionProposal(
        revision_root_id=100,
        revision_of_id=100,
        version=2,
    )
    second = compute_revision_proposal(
        project_id=101,
        revision_root_id=100,
        revision_of_id=100,
        version=2,
        status=ProjectStatus.APPROVED,
    )
    assert second == RevisionProposal(
        revision_root_id=100,
        revision_of_id=101,
        version=3,
    )

    assert first.revision_root_id == 100
    assert first.revision_of_id == 100
    assert first.version == 2

    for invalid in (
        {
            "project_id": 200,
            "revision_root_id": 200,
            "revision_of_id": None,
            "version": 1,
            "status": ProjectStatus.DRAFT,
        },
        {
            "project_id": 201,
            "revision_root_id": None,
            "revision_of_id": 201,
            "version": 4,
            "status": ProjectStatus.APPROVED,
        },
        {
            "project_id": 202,
            "revision_root_id": None,
            "revision_of_id": None,
            "version": 0,
            "status": ProjectStatus.APPROVED,
        },
        {
            "project_id": 203,
            "revision_root_id": 999,
            "revision_of_id": None,
            "version": 1,
            "status": ProjectStatus.APPROVED,
        },
    ):
        try:
            compute_revision_proposal(**invalid)
        except RevisionProposalError as exc:
            assert exc.code in {
                "revision_status_must_be_approved",
                "revision_circular_reference",
                "invalid_version_state",
                "invalid_revision_lineage",
            }
        else:
            raise AssertionError(f"invalid revision proposal should fail: {invalid}")
