import { useState } from 'react'
import { Pin, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CategoryBadge, PriorityBadge } from '@/components/announcement/AnnouncementBadge'
import AnnouncementDetailModal from '@/components/announcement/AnnouncementDetailModal'
import { useAnnouncements, useMarkAllAsRead } from '@/hooks/useAnnouncements'
import type { Announcement, AnnouncementCategory } from '@/types'

const CATEGORY_FILTERS: { value: string; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'bug_fix', label: '버그 수정' },
  { value: 'new_feature', label: '신규 기능' },
  { value: 'rule_change', label: '규칙 변경' },
  { value: 'general', label: '일반' },
]

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function AnnouncementListPage() {
  const [categoryFilter, setCategoryFilter] = useState('')
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  const { data, isLoading } = useAnnouncements(0, 100)
  const markAllMutation = useMarkAllAsRead()

  const announcements = data?.items ?? []

  const filtered = categoryFilter
    ? announcements.filter((a) => a.category === categoryFilter)
    : announcements

  const handleOpen = (announcement: Announcement) => {
    setSelectedAnnouncement(announcement)
    setIsDetailOpen(true)
  }

  const unreadCount = announcements.filter((a) => !a.is_read).length

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">공지사항</h1>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
          >
            <CheckCheck className="h-4 w-4 mr-1" />
            모두 읽음 처리 ({unreadCount})
          </Button>
        )}
      </div>

      {/* 카테고리 필터 */}
      <div className="flex gap-2 mb-4">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setCategoryFilter(f.value)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              categoryFilter === f.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {isLoading && (
        <div className="py-12 text-center text-muted-foreground">로딩 중...</div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">공지사항이 없습니다.</div>
      )}

      <div className="space-y-2">
        {filtered.map((a) => (
          <button
            key={a.id}
            onClick={() => handleOpen(a)}
            className={`w-full text-left rounded-lg border p-4 transition-colors hover:bg-muted/50 ${
              !a.is_read ? 'bg-blue-50/50 border-blue-200' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              {/* 읽음 표시 */}
              <div className="mt-1 shrink-0">
                {!a.is_read && (
                  <span className="block h-2 w-2 rounded-full bg-blue-500" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {a.is_pinned && <Pin className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                  <span className={`text-sm font-medium truncate ${!a.is_read ? 'font-semibold' : ''}`}>
                    {a.title}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{a.content}</p>
                <div className="flex items-center gap-2 mt-2">
                  <CategoryBadge category={a.category as AnnouncementCategory} />
                  <PriorityBadge priority={a.priority} />
                  <span className="text-xs text-muted-foreground ml-auto">
                    {a.creator_userid ?? ''} · {formatDate(a.created_at)}
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <AnnouncementDetailModal
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        announcement={selectedAnnouncement}
      />
    </div>
  )
}
