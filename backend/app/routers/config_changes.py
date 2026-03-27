"""설정 변경 합의(Config Change Consensus) API 라우터.

라인 관리자가 시스템 설정 변경을 요청하고, 투표하고, 구현을 관리하는 API를 제공한다.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import (
    require_active_user,
    require_admin_or_developer,
    require_reviewer,
)
from app.models.user import User
from app.schemas.config_change import (
    ConfigChangeCreateRequest,
    ConfigChangeDetailResponse,
    ConfigChangeListResponse,
    ConfigChangeRejectRequest,
    ConfigChangeVoteRequest,
)
from app.services import config_change_service

router = APIRouter(prefix="/config-changes", tags=["config-changes"])


@router.post("", response_model=ConfigChangeDetailResponse, status_code=201)
async def create_config_change_request(
    data: ConfigChangeCreateRequest,
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
):
    """설정 변경 요청을 생성한다.

    reviewer 또는 admin 역할이 필요하다.
    생성 시 모든 등록된 라인에 대한 투표 레코드가 자동 생성된다.
    """
    return await config_change_service.create_request(db, data, current_user)


@router.get("", response_model=ConfigChangeListResponse)
async def list_config_change_requests(
    status: str | None = Query(None, description="상태 필터"),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    _current_user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
):
    """설정 변경 요청 목록을 조회한다.

    모든 활성 사용자가 조회 가능하며, status 파라미터로 필터링할 수 있다.
    """
    return await config_change_service.list_requests(db, status=status, offset=offset, limit=limit)


# /me 경로는 /{request_id} 보다 먼저 등록해야 "me"가 path param으로 파싱되지 않음
@router.get("/me/pending-vote-count")
async def get_my_pending_vote_count(
    current_user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
):
    """현재 사용자가 투표해야 하는 pending 요청 건수를 반환한다."""
    count = await config_change_service.get_my_pending_vote_count(db, current_user)
    return {"count": count}


@router.get("/{request_id}", response_model=ConfigChangeDetailResponse)
async def get_config_change_detail(
    request_id: int,
    _current_user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
):
    """설정 변경 요청 상세 정보를 투표 목록과 함께 조회한다."""
    return await config_change_service.get_request_detail(db, request_id)


@router.post("/{request_id}/vote", response_model=ConfigChangeDetailResponse)
async def vote_config_change(
    request_id: int,
    data: ConfigChangeVoteRequest,
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
):
    """설정 변경 요청에 투표한다.

    reviewer 또는 admin 역할이 필요하며, 역할에 따라 라인/관리자 슬롯에 투표한다.
    반려(reject) 투표 시 사유(reason)가 필수이다.
    """
    return await config_change_service.vote(db, request_id, current_user, data)


@router.patch("/{request_id}/start", response_model=ConfigChangeDetailResponse)
async def start_config_change_implementation(
    request_id: int,
    current_user: User = Depends(require_admin_or_developer),
    db: AsyncSession = Depends(get_db),
):
    """승인된 설정 변경 요청의 구현을 시작한다 (approved -> in_progress).

    admin 또는 developer 역할이 필요하다.
    """
    return await config_change_service.start_implementation(db, request_id, current_user)


@router.patch("/{request_id}/complete", response_model=ConfigChangeDetailResponse)
async def complete_config_change_implementation(
    request_id: int,
    current_user: User = Depends(require_admin_or_developer),
    db: AsyncSession = Depends(get_db),
):
    """진행 중인 설정 변경 구현을 완료한다 (in_progress -> completed).

    admin 또는 developer 역할이 필요하다.
    """
    return await config_change_service.complete_implementation(db, request_id, current_user)


@router.patch("/{request_id}/cancel", response_model=ConfigChangeDetailResponse)
async def cancel_config_change_request(
    request_id: int,
    current_user: User = Depends(require_active_user),
    db: AsyncSession = Depends(get_db),
):
    """대기 중인 설정 변경 요청을 취소한다 (pending -> cancelled).

    요청자 본인 또는 admin만 취소할 수 있다.
    """
    return await config_change_service.cancel_request(db, request_id, current_user)


@router.patch("/{request_id}/reject", response_model=ConfigChangeDetailResponse)
async def reject_config_change_by_developer(
    request_id: int,
    data: ConfigChangeRejectRequest,
    current_user: User = Depends(require_admin_or_developer),
    db: AsyncSession = Depends(get_db),
):
    """승인된 요청을 개발자/관리자가 반려한다 (approved -> rejected).

    구현이 기술적으로 불가능하거나 수정이 필요할 때 사용한다.
    반려 사유(reason) 필수.
    """
    return await config_change_service.reject_by_developer(db, request_id, current_user, data)
