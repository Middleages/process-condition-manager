"""사용자 공지사항 API 엔드포인트."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.announcement import (
    AnnouncementListResponse,
    AnnouncementResponse,
    UnreadCountResponse,
)
from app.services import announcement_service

router = APIRouter(prefix="/announcements", tags=["announcements"])


@router.get("", response_model=AnnouncementListResponse)
async def list_announcements(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """활성 공지사항 목록 조회 (읽음 여부 포함)."""
    return await announcement_service.list_announcements(db, user.id, offset=offset, limit=limit)


# /unread-count 와 /read-all 은 /{announcement_id} 보다 먼저 정의해야 경로 충돌 방지
@router.get("/unread-count", response_model=UnreadCountResponse)
async def get_unread_count(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """읽지 않은 공지 수 조회."""
    count = await announcement_service.get_unread_count(db, user.id)
    return {"count": count}


@router.post("/read-all", status_code=204)
async def mark_all_as_read(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """모든 공지사항 읽음 처리."""
    await announcement_service.mark_all_as_read(db, user.id)
    return None


@router.get("/{announcement_id}", response_model=AnnouncementResponse)
async def get_announcement(
    announcement_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """단일 공지사항 조회."""
    return await announcement_service.get_announcement(db, announcement_id, user.id)


@router.post("/{announcement_id}/read", status_code=204)
async def mark_as_read(
    announcement_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """공지사항 읽음 처리."""
    await announcement_service.mark_as_read(db, announcement_id, user.id)
    return None
