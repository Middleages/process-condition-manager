"""Approval workflow and review comment routes."""

from __future__ import annotations

import asyncio
import json
import random
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import (
    UserContext,
    get_current_user,
    require_business_read,
    require_project_comment,
    require_project_review_decide,
    require_project_review_request,
    require_project_revision_create,
)
from app.core.db import get_app_session
from app.core.errors import ConflictError, DomainValidationError
from app.core.maintenance import require_project_mutations_enabled
from app.features.approval.repository import ApprovalRepository
from app.features.approval.schema import (
    CommentCreateIn,
    CommentListOut,
    CommentOut,
    CommentQuery,
    CommentResolveIn,
    ReviewAction,
    RevisionOut,
    RevisionSourceOut,
    TransitionIn,
    TransitionOut,
)
from app.features.approval.service import ApprovalService, allowed_actions_for_user
from app.features.projects.schema import ChoiceValueOut, LayerOut, ProjectOut, ProjectProfileOut
from app.models.project import Project

router = APIRouter(
    prefix="/projects",
    tags=["approval"],
    dependencies=[Depends(get_current_user)],
)


async def get_service(
    session: Annotated[AsyncSession, Depends(get_app_session, scope="function")],
) -> AsyncIterator[ApprovalService]:
    service = ApprovalService(ApprovalRepository(session))
    yield service
    await session.commit()


ServiceDep = Annotated[ApprovalService, Depends(get_service, scope="function")]
UserDep = Annotated[UserContext, Depends(get_current_user)]
_RETRYABLE_TRANSACTION_STATES = frozenset({"40001", "40P01"})


async def _run_consistent_operation[T](
    service: ApprovalService,
    operation: Callable[[], Awaitable[T]],
) -> T:
    """Retry a whole expected-status operation on PostgreSQL transaction conflicts."""
    for attempt in range(3):
        try:
            result = await operation()
            await service.repo.session.commit()
            return result
        except DBAPIError as exc:
            await service.repo.session.rollback()
            if _dbapi_sqlstate(exc) not in _RETRYABLE_TRANSACTION_STATES:
                raise
            if attempt == 2:
                raise ConflictError(
                    "동시 워크플로우 변경과 충돌했습니다",
                    code="workflow_status_conflict",
                ) from exc
            await asyncio.sleep(0.005 * (attempt + 1) + random.uniform(0, 0.005))
    raise AssertionError("transaction retry loop exhausted")


def _dbapi_sqlstate(exc: DBAPIError) -> str | None:
    error = exc.orig
    for attr in ("sqlstate", "pgcode"):
        code = getattr(error, attr, None)
        if code:
            return str(code)
    return None


async def _ensure_transition_permission(action: ReviewAction, user: UserContext) -> None:
    if action in {"request_review", "return_to_draft"}:
        await require_project_review_request(user=user)
    else:
        await require_project_review_decide(user=user)


def _comment_to_out(comment: object) -> CommentOut:
    payload = CommentOut.model_validate(comment).model_dump()
    if getattr(comment, "deleted", False):
        payload["body"] = None
    return CommentOut.model_validate(payload)


@router.get(
    "/{project_id}/comments",
    response_model=CommentListOut,
    dependencies=[Depends(require_business_read)],
)
async def list_comments(
    project_id: int,
    query: Annotated[CommentQuery, Depends()],
    service: ServiceDep,
) -> CommentListOut:
    comments, next_cursor = await service.list_comments(
        project_id,
        before_id=query.before_id,
        condition_id=query.condition_id,
        layer_key=query.layer_key,
        parameter_code=query.parameter_code,
        resolved=query.resolved,
        target=query.target,
        limit=query.limit,
    )
    page = CommentListOut(
        items=[_comment_to_out(comment) for comment in comments],
        next_cursor=next_cursor,
    )
    while (
        len(json.dumps(page.model_dump(mode="json"), ensure_ascii=False).encode("utf-8"))
        > 240 * 1024
    ):
        page.items.pop()
        if not page.items:
            raise AssertionError("one bounded comment exceeds response budget")
        page.next_cursor = page.items[-1].id
    return page


@router.post(
    "/{project_id}/comments",
    response_model=CommentOut,
    dependencies=[Depends(require_project_comment), Depends(require_project_mutations_enabled)],
    status_code=201,
)
async def create_comment(
    project_id: int,
    data: CommentCreateIn,
    service: ServiceDep,
    user: UserDep,
) -> CommentOut:
    comment = await service.create_comment(
        project_id,
        body=data.body,
        actor=user.id,
        condition_id=data.condition_id,
        layer_key=data.layer_key,
        parameter_code=data.parameter_code,
    )
    return _comment_to_out(comment)


@router.patch(
    "/{project_id}/comments/{comment_id}",
    response_model=CommentOut,
    dependencies=[Depends(require_project_comment), Depends(require_project_mutations_enabled)],
)
async def set_comment_resolved(
    project_id: int,
    comment_id: int,
    data: CommentResolveIn,
    service: ServiceDep,
    user: UserDep,
) -> CommentOut:
    comment = await service.set_comment_resolved(
        project_id,
        comment_id,
        actor=user.id,
        resolved=data.resolved,
    )
    return _comment_to_out(comment)


@router.delete(
    "/{project_id}/comments/{comment_id}",
    status_code=204,
    dependencies=[Depends(require_project_comment), Depends(require_project_mutations_enabled)],
)
async def delete_comment(
    project_id: int,
    comment_id: int,
    service: ServiceDep,
    user: UserDep,
) -> None:
    await service.delete_comment(project_id, comment_id, actor=user.id, user=user)


@router.post(
    "/{project_id}/transitions",
    response_model=TransitionOut,
    dependencies=[Depends(require_project_mutations_enabled)],
)
async def transition_project(
    project_id: int,
    data: TransitionIn,
    service: ServiceDep,
    user: UserDep,
) -> TransitionOut:
    await _ensure_transition_permission(data.action, user)
    project, operation_id, revalidated = await _run_consistent_operation(
        service,
        lambda: service.transition_project(
            project_id,
            action=data.action,
            actor=user.id,
            expected_status=data.expected_status,
        ),
    )
    return TransitionOut(
        project_id=project.id,
        status=project.status,
        allowed_actions=allowed_actions_for_user(
            project.status,
            permissions=user.permissions,
        ),
        basis_hash=project.review_basis_hash,
        rule_versions=project.review_rule_versions,
        revalidated=revalidated,
        operation_id=operation_id,
    )


@router.post(
    "/{project_id}/revisions",
    response_model=RevisionOut,
    dependencies=[
        Depends(require_project_revision_create),
        Depends(require_project_mutations_enabled),
    ],
)
async def create_revision(
    project_id: int,
    service: ServiceDep,
    user: UserDep,
) -> RevisionOut:
    async def operation() -> RevisionOut:
        source, target, operation_id = await service.create_revision(
            project_id,
            actor=user.id,
        )
        # Project the response before commit so a projection/configuration
        # failure cannot leave a durable revision behind an error response.
        return RevisionOut(
            operation_id=operation_id,
            source=RevisionSourceOut(
                id=source.id,
                status=source.status,
                version=source.version,
            ),
            revision=await _revision_project_out(service, target, user),
        )

    return await _run_consistent_operation(service, operation)


async def _revision_project_out(
    service: ApprovalService,
    project: Project,
    user: UserContext,
) -> ProjectOut:
    profile = project.profile
    choice_sets = {row.code: row for row in await service.repo.list_choice_sets()}

    def choice(set_code: str, option_code: str | None) -> ChoiceValueOut | None:
        if option_code is None:
            return None
        choice_set = choice_sets.get(set_code)
        option = (
            next(
                (item for item in choice_set.options if item.code == option_code),
                None,
            )
            if choice_set is not None
            else None
        )
        if choice_set is None or option is None:
            raise DomainValidationError(
                f"Project Profile 선택지를 해석할 수 없다: {set_code}/{option_code}"
            )
        return ChoiceValueOut(
            code=option.code,
            label=option.label,
            is_active=choice_set.is_active and option.is_active,
        )

    def required_choice(set_code: str, option_code: str) -> ChoiceValueOut:
        resolved = choice(set_code, option_code)
        assert resolved is not None
        return resolved

    return ProjectOut(
        id=project.id,
        line_id=project.line_id,
        process_id=project.process_id,
        part_id=project.part_id,
        name=project.name,
        status=project.status.value,
        version=project.version,
        revision_root_id=project.revision_root_id,
        predecessor_project_id=project.revision_of_id,
        successor_project_id=None,
        allowed_actions=allowed_actions_for_user(
            project.status,
            permissions=user.permissions,
        ),
        profile=ProjectProfileOut(
            project_id=project.id,
            process_name=profile.process_name,
            device_type=required_choice("device_type", profile.device_type_code),
            project_category=required_choice("project_category", profile.project_category_code),
            comment=profile.comment,
            active_direction=choice("active_direction", profile.active_direction_code),
            gate_direction=choice("gate_direction", profile.gate_direction_code),
            gross_die=profile.gross_die,
            pitch_x=profile.pitch_x,
            pitch_y=profile.pitch_y,
            shot_x=profile.shot_x,
            shot_y=profile.shot_y,
            slit_occupancy=profile.slit_occupancy,
            lens_occupancy=profile.lens_occupancy,
            map_offset_x=profile.map_offset_x,
            map_offset_y=profile.map_offset_y,
            scribe_lane_x=profile.scribe_lane_x,
            scribe_lane_y=profile.scribe_lane_y,
            shot_count=profile.shot_count,
            full_shot=profile.full_shot,
            layer_total=profile.layer_total,
            euv=profile.euv,
            imm=profile.imm,
            arf=profile.arf,
            krf=profile.krf,
            iline=profile.iline,
            soh=profile.soh,
            pspi=profile.pspi,
            metal_layer_count=profile.metal_layer_count,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        ),
        layers=[
            LayerOut(
                id=layer.id,
                layer_key=layer.layer_key,
                step_seq=layer.step_seq,
                layer_id=layer.layer_id,
                eqp_type=layer.eqp_type,
                eqp_type_desc=layer.eqp_type_desc,
                area_name=layer.area_name,
                sort_order=layer.sort_order,
                condition_count=len(layer.conditions),
                cell_count=sum(len(condition.cell_values) for condition in layer.conditions),
                source_project_id=layer.source_project_id,
                source_layer_key=layer.source_layer_key,
            )
            for layer in project.layers
        ],
    )


__all__ = ["router"]
