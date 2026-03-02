"""관리자 공지사항 API 엔드포인트."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_admin
from app.models.user import User
from app.schemas.announcement import (
    AnnouncementCreate,
    AnnouncementListResponse,
    AnnouncementResponse,
    AnnouncementUpdate,
)
from app.services import announcement_service

router = APIRouter(prefix="/api/admin/announcements", tags=["admin-announcements"])


@router.get("", response_model=AnnouncementListResponse)
async def list_admin_announcements(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """관리자용 공지 목록 조회 (비활성 포함)."""
    return await announcement_service.list_admin_announcements(db, offset=offset, limit=limit)


@router.post("", response_model=AnnouncementResponse, status_code=201)
async def create_announcement(
    data: AnnouncementCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """공지사항 생성."""
    announcement = await announcement_service.create_announcement(db, data, admin.id)
    return announcement


@router.put("/{announcement_id}", response_model=AnnouncementResponse)
async def update_announcement(
    announcement_id: int,
    data: AnnouncementUpdate,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """공지사항 수정."""
    return await announcement_service.update_announcement(db, announcement_id, data)


@router.delete("/{announcement_id}", status_code=204)
async def delete_announcement(
    announcement_id: int,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """공지사항 소프트 삭제 (비활성화)."""
    await announcement_service.delete_announcement(db, announcement_id)
    return None
