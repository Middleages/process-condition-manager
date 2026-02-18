import { useNavigate } from 'react-router-dom'
import { useProductRevisions } from '@/hooks/useProjects'
import { StatusBadge } from './StatusBadge'
import type { ProjectStatus } from '@/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'

interface VersionHistoryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: number | null
  currentProjectId: number
}

export function VersionHistoryModal({
  open,
  onOpenChange,
  productId,
  currentProjectId,
}: VersionHistoryModalProps) {
  const navigate = useNavigate()
  const { data, isLoading } = useProductRevisions(productId)

  const handleVersionClick = (projectId: number) => {
    onOpenChange(false)
    navigate(`/projects/${projectId}/edit`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>버전 히스토리 - {data?.product_name || '...'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !data || data.revisions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              버전 히스토리가 없습니다.
            </div>
          ) : (
            <div className="border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="border-b">
                    <th className="text-left px-4 py-3 font-medium w-20">버전</th>
                    <th className="text-left px-4 py-3 font-medium w-24">상태</th>
                    <th className="text-left px-4 py-3 font-medium">설명</th>
                    <th className="text-left px-4 py-3 font-medium w-32">생성자</th>
                    <th className="text-left px-4 py-3 font-medium w-40">생성일</th>
                  </tr>
                </thead>
                <tbody>
                  {data.revisions.map((rev) => {
                    const isCurrent = rev.id === currentProjectId
                    return (
                      <tr
                        key={rev.id}
                        className={`border-b hover:bg-muted/30 cursor-pointer transition-colors ${
                          isCurrent ? 'bg-blue-50' : ''
                        }`}
                        onClick={() => handleVersionClick(rev.id)}
                      >
                        <td className="px-4 py-3 font-medium">
                          v{rev.revision}
                          {isCurrent && (
                            <span className="ml-2 text-xs text-blue-600">(현재)</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={rev.status as ProjectStatus} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {rev.revision_reason || '-'}
                        </td>
                        <td className="px-4 py-3">{rev.created_by || '-'}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(rev.created_at).toLocaleDateString('ko-KR', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
