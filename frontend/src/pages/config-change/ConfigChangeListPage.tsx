import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, FileText, Clock, CheckCircle, XCircle, AlertCircle, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/useAuthStore'
import { hasAnyRole } from '@/lib/permissions'
import { useConfigChanges, useCreateConfigChange } from '@/hooks/useConfigChanges'
import type { ConfigChangeStatus, ConfigChangeType, ConfigChangeResponse } from '@/types'

const STATUS_TABS: { value: string | null; label: string }[] = [
  { value: null, label: '전체' },
  { value: 'pending', label: '대기중' },
  { value: 'approved', label: '승인됨' },
  { value: 'in_progress', label: '진행중' },
  { value: 'completed', label: '완료' },
  { value: 'rejected', label: '거부됨' },
  { value: 'cancelled', label: '취소됨' },
]

const STATUS_STYLES: Record<ConfigChangeStatus, { className: string; icon: typeof Clock }> = {
  pending: { className: 'bg-amber-100 text-amber-800', icon: Clock },
  approved: { className: 'bg-blue-100 text-blue-800', icon: CheckCircle },
  rejected: { className: 'bg-red-100 text-red-800', icon: XCircle },
  in_progress: { className: 'bg-indigo-100 text-indigo-800', icon: AlertCircle },
  completed: { className: 'bg-green-100 text-green-800', icon: CheckCircle },
  cancelled: { className: 'bg-gray-100 text-gray-600', icon: Ban },
}

const STATUS_LABELS: Record<ConfigChangeStatus, string> = {
  pending: '대기중',
  approved: '승인됨',
  rejected: '거부됨',
  in_progress: '진행중',
  completed: '완료',
  cancelled: '취소됨',
}

const CHANGE_TYPE_LABELS: Record<ConfigChangeType, string> = {
  column_add: '컬럼 추가',
  column_modify: '컬럼 수정',
  validation_change: '검증 규칙 변경',
}

function VoteProgress({ item }: { item: ConfigChangeResponse }) {
  const summary = item.vote_summary
  if (!summary || summary.total === 0) return <span className="text-xs text-muted-foreground">-</span>
  const pct = Math.round(((summary.approved + summary.rejected) / summary.total) * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden max-w-[80px]">
        <div
          className="h-full bg-green-500 rounded-full"
          style={{ width: `${Math.round((summary.approved / summary.total) * 100)}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {summary.approved}/{summary.total} ({pct}%)
      </span>
    </div>
  )
}

export default function ConfigChangeListPage() {
  const { user } = useAuthStore()
  const canCreate = hasAnyRole(user?.roles, ['reviewer', 'admin'])

  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const limit = 20

  const { data, isLoading } = useConfigChanges(statusFilter, page * limit, limit)

  // 생성 모달
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [changeType, setChangeType] = useState<ConfigChangeType>('column_add')
  const [createError, setCreateError] = useState('')

  const createMutation = useCreateConfigChange()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    try {
      await createMutation.mutateAsync({ title, description, change_type: changeType })
      setIsCreateOpen(false)
      setTitle('')
      setDescription('')
      setChangeType('column_add')
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setCreateError(axErr.response?.data?.detail ?? '생성 중 오류가 발생했습니다.')
    }
  }

  const totalPages = data ? Math.ceil(data.total / limit) : 0

  return (
    <div className="p-6 h-full overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">설정 변경 요청</h1>
        {canCreate && (
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            새 요청
          </Button>
        )}
      </div>

      {/* 상태 탭 */}
      <div className="flex gap-1 mb-4 border-b pb-2 overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value ?? 'all'}
            onClick={() => { setStatusFilter(tab.value); setPage(0) }}
            className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors ${
              statusFilter === tab.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 목록 테이블 */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium w-12">#</th>
              <th className="px-4 py-3 text-left font-medium">제목</th>
              <th className="px-4 py-3 text-left font-medium">유형</th>
              <th className="px-4 py-3 text-left font-medium">상태</th>
              <th className="px-4 py-3 text-left font-medium">투표</th>
              <th className="px-4 py-3 text-left font-medium">요청자</th>
              <th className="px-4 py-3 text-left font-medium">생성일</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  로딩 중...
                </td>
              </tr>
            )}
            {!isLoading && (!data || data.items.length === 0) && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  변경 요청이 없습니다.
                </td>
              </tr>
            )}
            {data?.items.map((item) => {
              const style = STATUS_STYLES[item.status]
              return (
                <tr key={item.id} className="border-t hover:bg-muted/50">
                  <td className="px-4 py-3 text-muted-foreground">{item.id}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/config-changes/${item.id}`}
                      className="text-primary hover:underline font-medium"
                    >
                      {item.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs">{CHANGE_TYPE_LABELS[item.change_type]}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`${style.className} text-xs`}>
                      {STATUS_LABELS[item.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <VoteProgress item={item} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {item.requester_name ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(item.created_at).toLocaleDateString('ko-KR')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            이전
          </Button>
          <span className="text-sm text-muted-foreground">
            {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            다음
          </Button>
        </div>
      )}

      {/* 생성 모달 */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent onClose={() => setIsCreateOpen(false)}>
          <DialogHeader>
            <DialogTitle>설정 변경 요청</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">제목 *</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="변경 요청 제목"
                maxLength={200}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">변경 유형 *</label>
              <select
                value={changeType}
                onChange={(e) => setChangeType(e.target.value as ConfigChangeType)}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="column_add">컬럼 추가</option>
                <option value="column_modify">컬럼 수정</option>
                <option value="validation_change">검증 규칙 변경</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">설명 *</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                placeholder="변경이 필요한 내용을 상세히 기술해 주세요."
                rows={4}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
              />
            </div>
            {createError && <p className="text-red-600 text-sm">{createError}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                disabled={createMutation.isPending}
              >
                취소
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? '생성 중...' : '요청 생성'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
