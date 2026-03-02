import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import RichEditor from '@/components/ui/rich-editor'
import { useCreateAnnouncement, useUpdateAnnouncement } from '@/hooks/useAnnouncements'
import type { Announcement, AnnouncementCategory, AnnouncementPriority } from '@/types'

const CATEGORY_OPTIONS: { value: AnnouncementCategory; label: string }[] = [
  { value: 'bug_fix', label: '버그 수정' },
  { value: 'new_feature', label: '신규 기능' },
  { value: 'rule_change', label: '규칙 변경' },
  { value: 'general', label: '일반' },
]

const PRIORITY_OPTIONS: { value: AnnouncementPriority; label: string }[] = [
  { value: 'normal', label: '일반' },
  { value: 'important', label: '중요' },
  { value: 'critical', label: '긴급' },
]

interface AnnouncementFormModalProps {
  isOpen: boolean
  onClose: () => void
  announcement: Announcement | null
}

export function AnnouncementFormModal({
  isOpen,
  onClose,
  announcement,
}: AnnouncementFormModalProps) {
  const isEdit = !!announcement

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<AnnouncementCategory>('general')
  const [priority, setPriority] = useState<AnnouncementPriority>('normal')
  const [isPinned, setIsPinned] = useState(false)
  const [serverError, setServerError] = useState('')

  const createMutation = useCreateAnnouncement()
  const updateMutation = useUpdateAnnouncement()

  useEffect(() => {
    if (announcement) {
      setTitle(announcement.title)
      setContent(announcement.content)
      setCategory(announcement.category)
      setPriority(announcement.priority)
      setIsPinned(announcement.is_pinned)
    } else {
      setTitle('')
      setContent('')
      setCategory('general')
      setPriority('normal')
      setIsPinned(false)
    }
    setServerError('')
  }, [announcement, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')

    if (!title.trim()) {
      setServerError('제목을 입력해주세요.')
      return
    }
    if (!content.trim()) {
      setServerError('내용을 입력해주세요.')
      return
    }

    try {
      if (isEdit && announcement) {
        await updateMutation.mutateAsync({
          id: announcement.id,
          data: { title, content, category, priority, is_pinned: isPinned },
        })
      } else {
        await createMutation.mutateAsync({
          title,
          content,
          category,
          priority,
          is_pinned: isPinned,
        })
      }
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setServerError(axiosErr.response?.data?.detail ?? '저장 중 오류가 발생했습니다.')
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent onClose={onClose} className="w-[55vw] min-w-[600px] max-w-5xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? '공지사항 수정' : '공지사항 추가'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">제목 *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="공지사항 제목"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">내용 *</label>
            <RichEditor
              value={content}
              onChange={setContent}
              placeholder="공지사항 내용을 입력하세요..."
              minHeight="250px"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">카테고리</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as AnnouncementCategory)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">우선순위</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as AnnouncementPriority)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isPinned"
              checked={isPinned}
              onChange={(e) => setIsPinned(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="isPinned" className="text-sm font-medium">
              상단 고정
            </label>
          </div>
          {serverError && (
            <p className="text-red-600 text-sm">{serverError}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              취소
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
