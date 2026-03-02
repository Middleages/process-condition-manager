"""공지사항 서비스 레이어.

공지사항 CRUD, 읽음 처리, 미읽음 카운트 등 비즈니스 로직을 담당한다.
"""
from fastapi import HTTPException
from sqlalchemy import and_, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.announcement import Announcement, AnnouncementRead
from app.models.user import User
from app.schemas.announcement import AnnouncementCreate, AnnouncementUpdate


# ---------------------------------------------------------------------------
# 사용자 API
# ---------------------------------------------------------------------------


async def list_announcements(
    db: AsyncSession,
    user_id: int,
    offset: int = 0,
    limit: int = 20,
) -> dict:
    """활성 공지사항 목록을 읽음 여부와 함께 반환한다.

    고정(pinned) 공지가 먼저 표시되고, 이후 최신순으로 정렬된다.
    """
    # 읽음 여부 서브쿼리
    read_subq = (
        select(literal(True))
        .where(
            and_(
                AnnouncementRead.announcement_id == Announcement.id,
                AnnouncementRead.user_id == user_id,
            )
        )
        .correlate(Announcement)
        .exists()
    )

    # 전체 건수
    count_stmt = select(func.count()).select_from(Announcement).where(Announcement.is_active == True)  # noqa: E712
    total_result = await db.execute(count_stmt)
    total = total_result.scalar_one()

    # 메인 쿼리: 공지 + 읽음 여부 + 작성자 이름
    stmt = (
        select(
            Announcement,
            read_subq.label("is_read"),
            User.display_name.label("creator_name"),
        )
        .outerjoin(User, User.id == Announcement.created_by)
        .where(Announcement.is_active == True)  # noqa: E712
        .order_by(Announcement.is_pinned.desc(), Announcement.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.all()

    items = []
    for announcement, is_read, creator_name in rows:
        item = {
            "id": announcement.id,
            "title": announcement.title,
            "content": announcement.content,
            "category": announcement.category,
            "priority": announcement.priority,
            "is_active": announcement.is_active,
            "is_pinned": announcement.is_pinned,
            "created_by": announcement.created_by,
            "created_at": announcement.created_at,
            "updated_at": announcement.updated_at,
            "is_read": bool(is_read),
            "creator_name": creator_name,
        }
        items.append(item)

    return {"items": items, "total": total}


async def get_announcement(
    db: AsyncSession,
    announcement_id: int,
    user_id: int,
) -> dict:
    """단일 공지사항을 읽음 여부와 함께 반환한다.

    Raises:
        HTTPException 404: 공지사항이 존재하지 않거나 비활성일 때.
    """
    read_subq = (
        select(literal(True))
        .where(
            and_(
                AnnouncementRead.announcement_id == Announcement.id,
                AnnouncementRead.user_id == user_id,
            )
        )
        .correlate(Announcement)
        .exists()
    )

    stmt = (
        select(
            Announcement,
            read_subq.label("is_read"),
            User.display_name.label("creator_name"),
        )
        .outerjoin(User, User.id == Announcement.created_by)
        .where(
            Announcement.id == announcement_id,
            Announcement.is_active == True,  # noqa: E712
        )
    )
    result = await db.execute(stmt)
    row = result.one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="Announcement not found")

    announcement, is_read, creator_name = row
    return {
        "id": announcement.id,
        "title": announcement.title,
        "content": announcement.content,
        "category": announcement.category,
        "priority": announcement.priority,
        "is_active": announcement.is_active,
        "is_pinned": announcement.is_pinned,
        "created_by": announcement.created_by,
        "created_at": announcement.created_at,
        "updated_at": announcement.updated_at,
        "is_read": bool(is_read),
        "creator_name": creator_name,
    }


async def get_unread_count(db: AsyncSession, user_id: int) -> int:
    """사용자가 아직 읽지 않은 활성 공지사항 수를 반환한다."""
    read_exists = (
        select(literal(True))
        .where(
            and_(
                AnnouncementRead.announcement_id == Announcement.id,
                AnnouncementRead.user_id == user_id,
            )
        )
        .correlate(Announcement)
        .exists()
    )
    stmt = (
        select(func.count())
        .select_from(Announcement)
        .where(
            Announcement.is_active == True,  # noqa: E712
            ~read_exists,
        )
    )
    result = await db.execute(stmt)
    return result.scalar_one()


async def mark_as_read(
    db: AsyncSession,
    announcement_id: int,
    user_id: int,
) -> None:
    """공지사항을 읽음 처리한다.

    이미 읽은 경우 중복 삽입 없이 무시한다.

    Raises:
        HTTPException 404: 공지사항이 존재하지 않거나 비활성일 때.
    """
    # 공지 존재 및 활성 확인
    stmt = select(Announcement).where(
        Announcement.id == announcement_id,
        Announcement.is_active == True,  # noqa: E712
    )
    result = await db.execute(stmt)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Announcement not found")

    # 이미 읽었는지 확인 후 미읽음일 때만 삽입 (dialect 무관)
    exists_stmt = select(AnnouncementRead).where(
        AnnouncementRead.announcement_id == announcement_id,
        AnnouncementRead.user_id == user_id,
    )
    existing = await db.execute(exists_stmt)
    if not existing.scalar_one_or_none():
        db.add(AnnouncementRead(announcement_id=announcement_id, user_id=user_id))
        await db.commit()



async def mark_all_as_read(db: AsyncSession, user_id: int) -> None:
    """모든 활성 공지사항을 읽음 처리한다.

    읽지 않은 활성 공지만 INSERT 대상이 된다.
    """
    # 아직 읽지 않은 활성 공지 ID 조회
    read_exists = (
        select(literal(True))
        .where(
            and_(
                AnnouncementRead.announcement_id == Announcement.id,
                AnnouncementRead.user_id == user_id,
            )
        )
        .correlate(Announcement)
        .exists()
    )
    unread_stmt = (
        select(Announcement.id)
        .where(
            Announcement.is_active == True,  # noqa: E712
            ~read_exists,
        )
    )
    result = await db.execute(unread_stmt)
    unread_ids = [row[0] for row in result.all()]

    if not unread_ids:
        return

    # 벌크 삽입 (dialect 무관)
    for aid in unread_ids:
        db.add(AnnouncementRead(announcement_id=aid, user_id=user_id))
    await db.commit()


# ---------------------------------------------------------------------------
# 관리자 API
# ---------------------------------------------------------------------------


async def create_announcement(
    db: AsyncSession,
    data: AnnouncementCreate,
    admin_user_id: int,
) -> Announcement:
    """새 공지사항을 생성한다."""
    announcement = Announcement(
        title=data.title,
        content=data.content,
        category=data.category,
        priority=data.priority,
        is_pinned=data.is_pinned,
        created_by=admin_user_id,
    )
    db.add(announcement)
    await db.flush()
    await db.commit()
    await db.refresh(announcement)
    return announcement


async def update_announcement(
    db: AsyncSession,
    announcement_id: int,
    data: AnnouncementUpdate,
) -> Announcement:
    """공지사항을 수정한다.

    Raises:
        HTTPException 404: 공지사항이 존재하지 않을 때.
    """
    announcement = await db.get(Announcement, announcement_id)
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(announcement, key, value)

    await db.flush()
    await db.commit()
    await db.refresh(announcement)
    return announcement


async def delete_announcement(db: AsyncSession, announcement_id: int) -> None:
    """공지사항을 소프트 삭제(비활성화)한다.

    Raises:
        HTTPException 404: 공지사항이 존재하지 않을 때.
    """
    announcement = await db.get(Announcement, announcement_id)
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")

    announcement.is_active = False
    await db.flush()
    await db.commit()


async def list_admin_announcements(
    db: AsyncSession,
    offset: int = 0,
    limit: int = 50,
) -> dict:
    """관리자용 공지 목록 (비활성 포함, 읽음 상태 불필요).

    최신순 정렬, 페이지네이션 지원.
    """
    count_stmt = select(func.count()).select_from(Announcement)
    total_result = await db.execute(count_stmt)
    total = total_result.scalar_one()

    stmt = (
        select(Announcement, User.display_name.label("creator_name"))
        .outerjoin(User, User.id == Announcement.created_by)
        .order_by(Announcement.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.all()

    items = []
    for announcement, creator_name in rows:
        item = {
            "id": announcement.id,
            "title": announcement.title,
            "content": announcement.content,
            "category": announcement.category,
            "priority": announcement.priority,
            "is_active": announcement.is_active,
            "is_pinned": announcement.is_pinned,
            "created_by": announcement.created_by,
            "created_at": announcement.created_at,
            "updated_at": announcement.updated_at,
            "is_read": False,
            "creator_name": creator_name,
        }
        items.append(item)

    return {"items": items, "total": total}
