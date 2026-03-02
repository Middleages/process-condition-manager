import { useState } from 'react'
import { Plus, Pencil, Trash2, Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CategoryBadge, PriorityBadge } from '@/components/announcement/AnnouncementBadge'
import { AnnouncementFormModal } from '@/components/admin/AnnouncementFormModal'
import { useAdminAnnouncements, useDeleteAnnouncement } from '@/hooks/useAnnouncements'
import type { Announcement } from '@/types'

export default function AnnouncementManagementPage() {
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null)

  const { data, isLoading } = useAdminAnnouncements()
  const deleteMutation = useDeleteAnnouncement()

  const items = data?.items ?? []

  const handleAdd = () => {
    setSelectedAnnouncement(null)
    setIsFormOpen(true)
  }

  const handleEdit = (announcement: Announcement) => {
    setSelectedAnnouncement(announcement)
    setIsFormOpen(true)
  }

  const handleDelete = async (announcement: Announcement) => {
    if (!confirm(`'${announcement.title}' 공지사항을 삭제하시겠습니까?`)) return
    try {
      await deleteMutation.mutateAsync(announcement.id)
    } catch {
      alert('삭제 중 오류가 발생했습니다.')
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">공지사항 관리</h1>
        <Button onClick={handleAdd} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          공지사항 추가
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">제목</th>
              <th className="px-4 py-3 text-left font-medium">카테고리</th>
              <th className="px-4 py-3 text-left font-medium">우선순위</th>
              <th className="px-4 py-3 text-left font-medium">상태</th>
              <th className="px-4 py-3 text-center font-medium">고정</th>
              <th className="px-4 py-3 text-left font-medium">작성자</th>
              <th className="px-4 py-3 text-left font-medium">작성일</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  로딩 중...
                </td>
              </tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  공지사항이 없습니다.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr
                key={item.id}
                className={`border-t hover:bg-muted/50 ${!item.is_active ? 'opacity-50' : ''}`}
              >
                <td className="px-4 py-3 font-medium">{item.title}</td>
                <td className="px-4 py-3">
                  <CategoryBadge category={item.category} />
                </td>
                <td className="px-4 py-3">
                  <PriorityBadge priority={item.priority} />
                  {item.priority === 'normal' && (
                    <span className="text-xs text-muted-foreground">일반</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {item.is_active ? (
                    <Badge variant="outline" className="text-green-700 border-green-300">
                      활성
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-gray-500 border-gray-300">
                      비활성
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {item.is_pinned && (
                    <Pin className="h-4 w-4 text-primary inline-block" />
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {item.creator_name ?? '-'}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(item.created_at).toLocaleDateString('ko-KR')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(item)}
                      title="수정"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(item)}
                      title="삭제"
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AnnouncementFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        announcement={selectedAnnouncement}
      />
    </div>
  )
}
