import { useEffect, useRef } from 'react'
import { CategoryBadge } from '@/components/announcement/AnnouncementBadge'
import { useAnnouncements, useMarkAllAsRead } from '@/hooks/useAnnouncements'
import { Button } from '@/components/ui/button'
import type { Announcement } from '@/types'

interface AnnouncementDropdownProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (announcement: Announcement) => void
}

export default function AnnouncementDropdown({
  isOpen,
  onClose,
  onSelect,
}: AnnouncementDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { data } = useAnnouncements(0, 5)
  const markAllMutation = useMarkAllAsRead()

  // 드롭다운 외부 클릭 감지
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // 다음 틱에 리스너를 등록하여 토글 클릭과 충돌 방지
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const items = data?.items ?? []

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-full mt-2 w-80 bg-background border rounded-lg shadow-lg z-50"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="text-sm font-semibold">공지사항</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-6 px-2"
          onClick={() => markAllMutation.mutate()}
          disabled={markAllMutation.isPending}
        >
          모두 읽음
        </Button>
      </div>

      {/* 공지 목록 */}
      <div className="max-h-80 overflow-y-auto">
        {items.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            공지가 없습니다
          </div>
        )}
        {items.map((item) => (
          <button
            key={item.id}
            className={`w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors ${
              !item.is_read ? 'bg-blue-50' : ''
            }`}
            onClick={() => onSelect(item)}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium truncate flex-1">{item.title}</span>
              <CategoryBadge category={item.category} />
            </div>
            <p className="text-xs text-muted-foreground truncate">{item.content}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {new Date(item.created_at).toLocaleDateString('ko-KR')}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
