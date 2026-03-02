// 공지사항 카테고리
export type AnnouncementCategory = 'bug_fix' | 'new_feature' | 'rule_change' | 'general'

// 공지사항 우선순위
export type AnnouncementPriority = 'normal' | 'important' | 'critical'

export interface Announcement {
  id: number
  title: string
  content: string
  category: AnnouncementCategory
  priority: AnnouncementPriority
  is_active: boolean
  is_pinned: boolean
  created_by: number
  created_at: string
  updated_at: string
  is_read: boolean
  creator_name: string | null
}

export interface AnnouncementListResponse {
  items: Announcement[]
  total: number
}

export interface UnreadCountResponse {
  count: number
}

export interface AnnouncementCreate {
  title: string
  content: string
  category: AnnouncementCategory
  priority: AnnouncementPriority
  is_pinned: boolean
}

export interface AnnouncementUpdate {
  title?: string
  content?: string
  category?: AnnouncementCategory
  priority?: AnnouncementPriority
  is_pinned?: boolean
}
