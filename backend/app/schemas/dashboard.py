from datetime import datetime

from pydantic import BaseModel


class StatusCounts(BaseModel):
    draft: int = 0
    review: int = 0
    approved: int = 0
    rejected: int = 0


class MyRecentProject(BaseModel):
    id: int
    product_name: str
    status: str
    revision: int
    changed_cells_count: int
    updated_at: datetime


class ReviewPendingItem(BaseModel):
    id: int
    product_name: str
    creator_name: str
    changed_cells_count: int
    review_requested_at: datetime | None


class ActivityItem(BaseModel):
    id: int
    project_id: int
    product_name: str
    from_status: str
    to_status: str
    changer_name: str
    comment: str | None
    changed_at: datetime


class DashboardOverviewResponse(BaseModel):
    status_counts: StatusCounts
    my_recent_projects: list[MyRecentProject]
    review_pending: list[ReviewPendingItem]
    recent_activity: list[ActivityItem]
