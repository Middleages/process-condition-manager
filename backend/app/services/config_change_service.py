"""설정 변경 합의(Config Change Consensus) 서비스 레이어.

요청 생성, 투표, 합의 판정, 구현 시작/완료, 취소, 목록/상세 조회 로직을 담당한다.
"""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.constants import VALID_CONFIG_CHANGE_TRANSITIONS
from app.models.config_change import ConfigChangeRequest, ConfigChangeVote
from app.models.line import Line
from app.models.user import User
from app.schemas.config_change import (
    ConfigChangeCreateRequest,
    ConfigChangeDetailResponse,
    ConfigChangeListResponse,
    ConfigChangeResponse,
    ConfigChangeVoteRequest,
    ConfigChangeVoteResponse,
    VoteSummary,
)


# ---------------------------------------------------------------------------
# 헬퍼: 투표 요약 생성
# ---------------------------------------------------------------------------


def _build_vote_summary(votes: list[ConfigChangeVote]) -> VoteSummary:
    """투표 목록에서 승인/반려/미투표 수를 계산하여 요약 객체를 반환한다."""
    total = len(votes)
    approved = sum(1 for v in votes if v.vote == "approve")
    rejected = sum(1 for v in votes if v.vote == "reject")
    pending = total - approved - rejected
    return VoteSummary(total=total, approved=approved, rejected=rejected, pending=pending)


def _build_vote_response(vote: ConfigChangeVote) -> ConfigChangeVoteResponse:
    """투표 ORM 객체를 응답 스키마로 변환한다."""
    vote_type = "admin" if vote.line_id is None else "line"
    return ConfigChangeVoteResponse(
        id=vote.id,
        vote_type=vote_type,
        line_id=vote.line_id,
        line_name=vote.line.line_name if vote.line else None,
        line_code=vote.line.line_code if vote.line else None,
        vote=vote.vote,
        voted_by=vote.voted_by,
        voter_name=vote.voter.display_name if vote.voter else None,
        reason=vote.reason,
        voted_at=vote.voted_at,
    )


def _build_response(
    req: ConfigChangeRequest,
    *,
    include_votes: bool = False,
) -> ConfigChangeResponse | ConfigChangeDetailResponse:
    """요청 ORM 객체를 응답 스키마로 변환한다."""
    base = dict(
        id=req.id,
        title=req.title,
        description=req.description,
        change_type=req.change_type,
        status=req.status,
        requested_by=req.requested_by,
        requester_name=req.requester.display_name if req.requester else None,
        implemented_by=req.implemented_by,
        implementer_name=req.implementer.display_name if req.implementer else None,
        created_at=req.created_at,
        updated_at=req.updated_at,
        approved_at=req.approved_at,
        completed_at=req.completed_at,
        vote_summary=_build_vote_summary(req.votes) if req.votes is not None else None,
    )
    if include_votes:
        base["votes"] = [_build_vote_response(v) for v in req.votes]
        return ConfigChangeDetailResponse(**base)
    return ConfigChangeResponse(**base)


# ---------------------------------------------------------------------------
# 요청 생성
# ---------------------------------------------------------------------------


async def create_request(
    db: AsyncSession,
    data: ConfigChangeCreateRequest,
    current_user: User,
) -> ConfigChangeDetailResponse:
    """설정 변경 요청을 생성하고, 모든 라인에 대한 투표 레코드를 자동 생성한다.

    Raises:
        HTTPException 400: 등록된 라인이 없을 때.
    """
    # 모든 라인 조회
    lines_result = await db.execute(select(Line))
    all_lines = lines_result.scalars().all()

    if not all_lines:
        raise HTTPException(status_code=400, detail="등록된 라인이 없어 요청을 생성할 수 없습니다")

    # 요청 생성
    request = ConfigChangeRequest(
        title=data.title,
        description=data.description,
        change_type=data.change_type,
        status="pending",
        requested_by=current_user.id,
    )
    db.add(request)
    await db.flush()

    # 각 라인에 대한 투표 레코드 생성 (라인 reviewer용)
    for line in all_lines:
        vote = ConfigChangeVote(
            request_id=request.id,
            line_id=line.id,
        )
        db.add(vote)

    # 관리자 그룹 투표 레코드 1개 생성 (admin용, line_id=NULL)
    admin_vote = ConfigChangeVote(
        request_id=request.id,
        line_id=None,
    )
    db.add(admin_vote)

    await db.flush()
    await db.commit()

    # 관계 포함하여 다시 조회
    return await get_request_detail(db, request.id)


# ---------------------------------------------------------------------------
# 투표
# ---------------------------------------------------------------------------


async def vote(
    db: AsyncSession,
    request_id: int,
    current_user: User,
    data: ConfigChangeVoteRequest,
) -> ConfigChangeDetailResponse:
    """사용자의 역할에 따라 투표한다.

    - admin 역할: 관리자 투표 슬롯(line_id=NULL)에 투표
    - reviewer 역할: 소속 라인 투표 슬롯에 투표

    Raises:
        HTTPException 404: 요청이 존재하지 않을 때.
        HTTPException 400: 요청이 pending 상태가 아닐 때.
        HTTPException 403: 투표 권한이 없거나 투표 슬롯이 없을 때.
        HTTPException 400: 이미 투표했거나 반려 사유가 없을 때.
    """
    # 요청 존재 확인
    req = await db.get(ConfigChangeRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="설정 변경 요청을 찾을 수 없습니다")

    # pending 상태 확인
    if req.status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"pending 상태의 요청만 투표할 수 있습니다 (현재: {req.status})",
        )

    # 역할에 따른 투표 슬롯 결정
    user_roles = current_user.roles or []

    if "admin" in user_roles:
        # admin → 관리자 투표 슬롯 (line_id IS NULL)
        vote_stmt = select(ConfigChangeVote).where(
            ConfigChangeVote.request_id == request_id,
            ConfigChangeVote.line_id.is_(None),
        )
    elif "reviewer" in user_roles:
        # reviewer → 소속 라인 투표 슬롯
        if not current_user.line_id:
            raise HTTPException(
                status_code=403,
                detail="소속 라인이 지정되지 않은 검토자는 투표할 수 없습니다",
            )
        vote_stmt = select(ConfigChangeVote).where(
            ConfigChangeVote.request_id == request_id,
            ConfigChangeVote.line_id == current_user.line_id,
        )
    else:
        raise HTTPException(
            status_code=403,
            detail="투표 권한이 없습니다 (reviewer 또는 admin 역할 필요)",
        )

    vote_result = await db.execute(vote_stmt)
    vote_record = vote_result.scalar_one_or_none()

    if not vote_record:
        raise HTTPException(
            status_code=403,
            detail="투표 레코드가 존재하지 않습니다",
        )

    # 이미 투표한 경우
    if vote_record.vote is not None:
        raise HTTPException(
            status_code=400,
            detail="이미 투표하셨습니다",
        )

    # 반려 시 사유 필수
    if data.vote == "reject" and not data.reason:
        raise HTTPException(
            status_code=400,
            detail="반려 투표에는 사유가 필수입니다",
        )

    # 투표 기록
    vote_record.vote = data.vote
    vote_record.voted_by = current_user.id
    vote_record.reason = data.reason
    vote_record.voted_at = datetime.now(timezone.utc)

    await db.flush()

    # 합의 판정
    await _check_and_update_consensus(db, request_id)

    await db.commit()

    return await get_request_detail(db, request_id)


# ---------------------------------------------------------------------------
# 합의 판정 (내부 함수)
# ---------------------------------------------------------------------------


async def _check_and_update_consensus(db: AsyncSession, request_id: int) -> None:
    """모든 투표를 확인하여 합의 상태를 업데이트한다.

    - 하나라도 반려(reject)가 있으면 → rejected
    - 전원 승인(approve)이면 → approved
    - 그 외 → pending 유지
    """
    req = await db.get(ConfigChangeRequest, request_id)
    if not req or req.status != "pending":
        return

    votes_stmt = select(ConfigChangeVote).where(
        ConfigChangeVote.request_id == request_id,
    )
    votes_result = await db.execute(votes_stmt)
    all_votes = votes_result.scalars().all()

    # 반려가 하나라도 있으면 즉시 반려 처리
    if any(v.vote == "reject" for v in all_votes):
        req.status = "rejected"
        await db.flush()
        return

    # 전원 승인이면 승인 처리
    if all(v.vote == "approve" for v in all_votes):
        req.status = "approved"
        req.approved_at = datetime.now(timezone.utc)
        await db.flush()
        return

    # 아직 미투표가 남아있으면 pending 유지


# ---------------------------------------------------------------------------
# 구현 시작 / 완료
# ---------------------------------------------------------------------------


async def start_implementation(
    db: AsyncSession,
    request_id: int,
    current_user: User,
) -> ConfigChangeDetailResponse:
    """승인된 요청의 구현을 시작한다 (approved → in_progress).

    Raises:
        HTTPException 404: 요청이 존재하지 않을 때.
        HTTPException 400: 상태 전환이 유효하지 않을 때.
    """
    req = await db.get(ConfigChangeRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="설정 변경 요청을 찾을 수 없습니다")

    allowed = VALID_CONFIG_CHANGE_TRANSITIONS.get(req.status, [])
    if "in_progress" not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"현재 상태({req.status})에서 구현을 시작할 수 없습니다",
        )

    req.status = "in_progress"
    req.implemented_by = current_user.id
    await db.flush()
    await db.commit()

    return await get_request_detail(db, request_id)


async def complete_implementation(
    db: AsyncSession,
    request_id: int,
    current_user: User,
) -> ConfigChangeDetailResponse:
    """진행 중인 구현을 완료한다 (in_progress → completed).

    Raises:
        HTTPException 404: 요청이 존재하지 않을 때.
        HTTPException 400: 상태 전환이 유효하지 않을 때.
    """
    req = await db.get(ConfigChangeRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="설정 변경 요청을 찾을 수 없습니다")

    allowed = VALID_CONFIG_CHANGE_TRANSITIONS.get(req.status, [])
    if "completed" not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"현재 상태({req.status})에서 구현을 완료할 수 없습니다",
        )

    req.status = "completed"
    req.completed_at = datetime.now(timezone.utc)
    await db.flush()
    await db.commit()

    return await get_request_detail(db, request_id)


# ---------------------------------------------------------------------------
# 요청 취소
# ---------------------------------------------------------------------------


async def cancel_request(
    db: AsyncSession,
    request_id: int,
    current_user: User,
) -> ConfigChangeDetailResponse:
    """대기 중인 요청을 취소한다 (pending → cancelled).

    요청자 본인 또는 admin만 취소할 수 있다.

    Raises:
        HTTPException 404: 요청이 존재하지 않을 때.
        HTTPException 400: 상태 전환이 유효하지 않을 때.
        HTTPException 403: 요청자가 아니고 admin도 아닐 때.
    """
    req = await db.get(ConfigChangeRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="설정 변경 요청을 찾을 수 없습니다")

    allowed = VALID_CONFIG_CHANGE_TRANSITIONS.get(req.status, [])
    if "cancelled" not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"현재 상태({req.status})에서 요청을 취소할 수 없습니다",
        )

    # 권한 확인: 요청자 본인 또는 admin
    if req.requested_by != current_user.id and "admin" not in (current_user.roles or []):
        raise HTTPException(
            status_code=403,
            detail="요청자 본인 또는 관리자만 취소할 수 있습니다",
        )

    req.status = "cancelled"
    await db.flush()
    await db.commit()

    return await get_request_detail(db, request_id)


# ---------------------------------------------------------------------------
# 목록 조회
# ---------------------------------------------------------------------------


async def list_requests(
    db: AsyncSession,
    status: str | None = None,
    offset: int = 0,
    limit: int = 20,
) -> ConfigChangeListResponse:
    """설정 변경 요청 목록을 조회한다 (투표 요약 포함).

    Args:
        db: 데이터베이스 세션
        status: 상태 필터 (None이면 전체)
        offset: 페이지네이션 오프셋
        limit: 페이지네이션 리밋
    """
    # 전체 건수
    count_stmt = select(func.count()).select_from(ConfigChangeRequest)
    if status:
        count_stmt = count_stmt.where(ConfigChangeRequest.status == status)
    total_result = await db.execute(count_stmt)
    total = total_result.scalar_one()

    # 메인 쿼리 (관계 eager 로딩)
    stmt = (
        select(ConfigChangeRequest)
        .options(
            selectinload(ConfigChangeRequest.requester),
            selectinload(ConfigChangeRequest.implementer),
            selectinload(ConfigChangeRequest.votes),
        )
        .order_by(ConfigChangeRequest.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    if status:
        stmt = stmt.where(ConfigChangeRequest.status == status)

    result = await db.execute(stmt)
    requests = result.scalars().all()

    items = [_build_response(req) for req in requests]
    return ConfigChangeListResponse(items=items, total=total)


# ---------------------------------------------------------------------------
# 상세 조회
# ---------------------------------------------------------------------------


async def get_request_detail(
    db: AsyncSession,
    request_id: int,
) -> ConfigChangeDetailResponse:
    """설정 변경 요청 상세 정보를 투표 목록과 함께 반환한다.

    Raises:
        HTTPException 404: 요청이 존재하지 않을 때.
    """
    stmt = (
        select(ConfigChangeRequest)
        .options(
            selectinload(ConfigChangeRequest.requester),
            selectinload(ConfigChangeRequest.implementer),
            selectinload(ConfigChangeRequest.votes).selectinload(ConfigChangeVote.line),
            selectinload(ConfigChangeRequest.votes).selectinload(ConfigChangeVote.voter),
        )
        .where(ConfigChangeRequest.id == request_id)
    )
    result = await db.execute(stmt)
    req = result.scalar_one_or_none()

    if not req:
        raise HTTPException(status_code=404, detail="설정 변경 요청을 찾을 수 없습니다")

    return _build_response(req, include_votes=True)
