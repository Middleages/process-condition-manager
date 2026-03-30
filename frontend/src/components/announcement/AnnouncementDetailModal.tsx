import { useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CategoryBadge, PriorityBadge } from '@/components/announcement/AnnouncementBadge'
import { useMarkAsRead } from '@/hooks/useAnnouncements'
import type { Announcement } from '@/types'

interface AnnouncementDetailModalProps {
  isOpen: boolean
  onClose: () => void
  announcement: Announcement | null
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AnnouncementDetailModal({
  isOpen,
  onClose,
  announcement,
}: AnnouncementDetailModalProps) {
  const markAsReadMutation = useMarkAsRead()

  useEffect(() => {
    if (isOpen && announcement && !announcement.is_read) {
      markAsReadMutation.mutate(announcement.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, announcement?.id])

  if (!announcement) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent onClose={onClose} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{announcement.title}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-4">
          <CategoryBadge category={announcement.category} />
          <PriorityBadge priority={announcement.priority} />
          <span className="text-sm text-muted-foreground ml-auto">
            {announcement.creator_userid ?? '알 수 없음'} | {formatDate(announcement.created_at)}
          </span>
        </div>

        <div
          className="text-sm leading-relaxed border-t pt-4 tiptap"
          dangerouslySetInnerHTML={{ __html: announcement.content }}
        />
      </DialogContent>
    </Dialog>
  )
}
