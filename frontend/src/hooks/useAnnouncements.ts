import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchAnnouncements,
  fetchUnreadCount,
  fetchAnnouncement,
  markAsRead,
  markAllAsRead,
  fetchAdminAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '@/api/announcements'
import type { AnnouncementCreate, AnnouncementUpdate } from '@/types'

export const announcementKeys = {
  all: ['announcements'] as const,
  list: (offset: number, limit: number) =>
    [...announcementKeys.all, 'list', offset, limit] as const,
  detail: (id: number) => [...announcementKeys.all, 'detail', id] as const,
  unreadCount: () => [...announcementKeys.all, 'unread-count'] as const,
  adminList: (offset: number, limit: number) =>
    [...announcementKeys.all, 'admin-list', offset, limit] as const,
}

// --- 사용자 훅 ---

export function useAnnouncements(offset = 0, limit = 20) {
  return useQuery({
    queryKey: announcementKeys.list(offset, limit),
    queryFn: () => fetchAnnouncements(offset, limit),
  })
}

export function useUnreadCount() {
  return useQuery({
    queryKey: announcementKeys.unreadCount(),
    queryFn: fetchUnreadCount,
    refetchInterval: 30_000, // 30초 폴링
  })
}

export function useAnnouncement(id: number) {
  return useQuery({
    queryKey: announcementKeys.detail(id),
    queryFn: () => fetchAnnouncement(id),
    enabled: id > 0,
  })
}

export function useMarkAsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => markAsRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: announcementKeys.all })
    },
  })
}

export function useMarkAllAsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markAllAsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: announcementKeys.all })
    },
  })
}

// --- 관리자 훅 ---

export function useAdminAnnouncements(offset = 0, limit = 50) {
  return useQuery({
    queryKey: announcementKeys.adminList(offset, limit),
    queryFn: () => fetchAdminAnnouncements(offset, limit),
  })
}

export function useCreateAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AnnouncementCreate) => createAnnouncement(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: announcementKeys.all })
    },
  })
}

export function useUpdateAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: AnnouncementUpdate }) =>
      updateAnnouncement(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: announcementKeys.all })
    },
  })
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteAnnouncement(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: announcementKeys.all })
    },
  })
}
