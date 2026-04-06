export interface StatusCounts {
  draft: number
  review: number
  approved: number
  rejected: number
}

export interface MyRecentProject {
  id: number
  product_name: string
  status: string
  revision: number
  changed_cells_count: number
  updated_at: string
}

export interface ReviewPendingItem {
  id: number
  product_name: string
  creator_userid: string
  changed_cells_count: number
  review_requested_at: string | null
}

export interface ActivityItem {
  id: number
  project_id: number
  product_name: string
  from_status: string
  to_status: string
  changer_userid: string
  comment: string | null
  changed_at: string
}

export interface DashboardOverview {
  status_counts: StatusCounts
  my_recent_projects: MyRecentProject[]
  review_pending: ReviewPendingItem[]
  recent_activity: ActivityItem[]
}
