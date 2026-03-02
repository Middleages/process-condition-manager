import client from './client'
import type {
  Announcement,
  AnnouncementCreate,
  AnnouncementListResponse,
  AnnouncementUpdate,
  UnreadCountResponse,
} from '@/types'

// --- 사용자 API ---

export async function fetchAnnouncements(
  offset = 0,
  limit = 20,
): Promise<AnnouncementListResponse> {
  const { data } = await client.get<AnnouncementListResponse>('/announcements', {
    params: { offset, limit },
  })
  return data
}

export async function fetchUnreadCount(): Promise<UnreadCountResponse> {
  const { data } = await client.get<UnreadCountResponse>('/announcements/unread-count')
  return data
}

export async function fetchAnnouncement(id: number): Promise<Announcement> {
  const { data } = await client.get<Announcement>(`/announcements/${id}`)
  return data
}

export async function markAsRead(id: number): Promise<void> {
  await client.post(`/announcements/${id}/read`)
}

export async function markAllAsRead(): Promise<void> {
  await client.post('/announcements/read-all')
}

// --- 관리자 API ---

export async function fetchAdminAnnouncements(
  offset = 0,
  limit = 50,
): Promise<AnnouncementListResponse> {
  const { data } = await client.get<AnnouncementListResponse>('/admin/announcements', {
    params: { offset, limit },
  })
  return data
}

export async function createAnnouncement(
  payload: AnnouncementCreate,
): Promise<Announcement> {
  const { data } = await client.post<Announcement>('/admin/announcements', payload)
  return data
}

export async function updateAnnouncement(
  id: number,
  payload: AnnouncementUpdate,
): Promise<Announcement> {
  const { data } = await client.put<Announcement>(`/admin/announcements/${id}`, payload)
  return data
}

export async function deleteAnnouncement(id: number): Promise<void> {
  await client.delete(`/admin/announcements/${id}`)
}
