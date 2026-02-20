"""Dashboard service — orchestrates repository calls into a single overview response."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.dashboard_repository import DashboardRepository
from app.schemas.dashboard import (
    ActivityItem,
    DashboardOverviewResponse,
    MyRecentProject,
    ReviewPendingItem,
    StatusCounts,
)


async def get_dashboard_overview(
    db: AsyncSession, user_id: int, line_id: int | None = None
) -> DashboardOverviewResponse:
    """Build the full dashboard overview by calling 4 repository queries."""
    status_counts = await DashboardRepository.fetch_status_counts(db, line_id=line_id)
    my_projects = await DashboardRepository.fetch_my_recent_projects(db, user_id, line_id=line_id)
    review_pending = await DashboardRepository.fetch_review_pending(db, line_id=line_id)
    activity = await DashboardRepository.fetch_recent_activity(db, line_id=line_id)

    return DashboardOverviewResponse(
        status_counts=StatusCounts(**status_counts),
        my_recent_projects=[MyRecentProject(**p) for p in my_projects],
        review_pending=[ReviewPendingItem(**r) for r in review_pending],
        recent_activity=[ActivityItem(**a) for a in activity],
    )
