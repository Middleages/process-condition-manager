import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  Play,
  CircleCheck,
  Ban,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useAuthStore } from '@/stores/useAuthStore'
import { hasAnyRole } from '@/lib/permissions'
import {
  useConfigChangeDetail,
  useVoteConfigChange,
  useStartConfigChange,
  useCompleteConfigChange,
  useCancelConfigChange,
} from '@/hooks/useConfigChanges'
import type {
  ConfigChangeStatus,
  ConfigChangeType,
  VoteResult,
  ConfigChangeVoteResponse,
} from '@/types'

const STATUS_LABELS: Record<ConfigChangeStatus, string> = {
  pending: '대기중',
  approved: '승인됨',
  rejected: '거부됨',
  in_progress: '진행중',
  completed: '완료',
  cancelled: '취소됨',
}

const STATUS_STYLES: Record<ConfigChangeStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  in_progress: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
}

const CHANGE_TYPE_LABELS: Record<ConfigChangeType, string> = {
  column_add: '컬럼 추가',
  column_modify: '컬럼 수정',
  validation_change: '검증 규칙 변경',
}

function VoteStatusIcon({ vote }: { vote: ConfigChangeVoteResponse }) {
  if (vote.vote === 'approve') return <CheckCircle className="h-4 w-4 text-green-600" />
  if (vote.vote === 'reject') return <XCircle className="h-4 w-4 text-red-600" />
  return <Clock className="h-4 w-4 text-amber-500" />
}

function VoteStatusLabel({ vote }: { vote: string | null }) {
  if (vote === 'approve') return <span className="text-green-700 font-medium">승인</span>
  if (vote === 'reject') return <span className="text-red-700 font-medium">거부</span>
  return <span className="text-amber-600">미투표</span>
}

export default function ConfigChangeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const requestId = Number(id)

  const { data: detail, isLoading } = useConfigChangeDetail(requestId)

  const voteMutation = useVoteConfigChange()
  const startMutation = useStartConfigChange()
  const completeMutation = useCompleteConfigChange()
  const cancelMutation = useCancelConfigChange()

  // 투표 다이얼로그
  const [isVoteOpen, setIsVoteOpen] = useState(false)
  const [voteChoice, setVoteChoice] = useState<VoteResult>('approve')
  const [voteReason, setVoteReason] = useState('')
  const [voteError, setVoteError] = useState('')

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center text-muted-foreground">
        로딩 중...
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        요청을 찾을 수 없습니다.
      </div>
    )
  }

  const isAdmin = user?.roles?.includes('admin') ?? false
  const isReviewer = user?.roles?.includes('reviewer') ?? false
  const isDevOrAdmin = hasAnyRole(user?.roles, ['developer', 'admin'])
  const isRequester = user?.id === detail.requested_by

  // 라인 투표와 관리자 투표 분리
  const lineVotes = detail.votes.filter((v) => v.vote_type === 'line')
  const adminVote = detail.votes.find((v) => v.vote_type === 'admin')

  // 역할 기반 투표 가능 여부 판정
  const myLineVote = lineVotes.find((v) => v.line_id === user?.line_id)
  const canVote =
    detail.status === 'pending' &&
    (
      (isAdmin && adminVote != null && adminVote.vote === null) ||
      (isReviewer && !isAdmin && user?.line_id != null && myLineVote != null && myLineVote.vote === null)
    )

  const canStart = detail.status === 'approved' && isDevOrAdmin
  const canComplete = detail.status === 'in_progress' && isDevOrAdmin
  const canCancel = detail.status === 'pending' && (isRequester || isAdmin)

  const handleVoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setVoteError('')
    if (voteChoice === 'reject' && !voteReason.trim()) {
      setVoteError('거부 사유를 입력해 주세요.')
      return
    }
    try {
      await voteMutation.mutateAsync({
        id: requestId,
        data: { vote: voteChoice, reason: voteReason || null },
      })
      setIsVoteOpen(false)
      setVoteReason('')
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setVoteError(axErr.response?.data?.detail ?? '투표 중 오류가 발생했습니다.')
    }
  }

  const handleStart = async () => {
    if (!confirm('이 요청의 구현을 시작하시겠습니까?')) return
    await startMutation.mutateAsync(requestId)
  }

  const handleComplete = async () => {
    if (!confirm('구현을 완료하시겠습니까?')) return
    await completeMutation.mutateAsync(requestId)
  }

  const handleCancel = async () => {
    if (!confirm('이 요청을 취소하시겠습니까?')) return
    await cancelMutation.mutateAsync(requestId)
  }

  return (
    <div className="p-6 h-full overflow-auto">
      {/* 뒤로가기 */}
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/config-changes')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          목록으로
        </Button>
      </div>

      {/* 요청 정보 카드 */}
      <div className="border rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold mb-2">{detail.title}</h1>
            <div className="flex items-center gap-3 text-sm">
              <Badge className={STATUS_STYLES[detail.status]}>
                {STATUS_LABELS[detail.status]}
              </Badge>
              <span className="text-muted-foreground">
                {CHANGE_TYPE_LABELS[detail.change_type]}
              </span>
            </div>
          </div>
          {/* 액션 버튼 */}
          <div className="flex gap-2">
            {canVote && (
              <Button size="sm" onClick={() => setIsVoteOpen(true)}>
                투표하기
              </Button>
            )}
            {canStart && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleStart}
                disabled={startMutation.isPending}
              >
                <Play className="h-3.5 w-3.5 mr-1" />
                작업 시작
              </Button>
            )}
            {canComplete && (
              <Button
                size="sm"
                onClick={handleComplete}
                disabled={completeMutation.isPending}
              >
                <CircleCheck className="h-3.5 w-3.5 mr-1" />
                적용 완료
              </Button>
            )}
            {canCancel && (
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:text-red-700"
                onClick={handleCancel}
                disabled={cancelMutation.isPending}
              >
                <Ban className="h-3.5 w-3.5 mr-1" />
                취소
              </Button>
            )}
          </div>
        </div>

        {/* 메타 정보 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
          <div>
            <span className="text-muted-foreground">요청자</span>
            <p className="font-medium">{detail.requester_name ?? '-'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">생성일</span>
            <p className="font-medium">
              {new Date(detail.created_at).toLocaleDateString('ko-KR')}
            </p>
          </div>
          {detail.approved_at && (
            <div>
              <span className="text-muted-foreground">승인일</span>
              <p className="font-medium">
                {new Date(detail.approved_at).toLocaleDateString('ko-KR')}
              </p>
            </div>
          )}
          {detail.implementer_name && (
            <div>
              <span className="text-muted-foreground">구현 담당자</span>
              <p className="font-medium">{detail.implementer_name}</p>
            </div>
          )}
          {detail.completed_at && (
            <div>
              <span className="text-muted-foreground">완료일</span>
              <p className="font-medium">
                {new Date(detail.completed_at).toLocaleDateString('ko-KR')}
              </p>
            </div>
          )}
        </div>

        {/* 설명 */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">설명</h3>
          <div
            className="text-sm bg-muted/50 rounded-md p-3 tiptap"
            dangerouslySetInnerHTML={{ __html: detail.description }}
          />
        </div>
      </div>

      {/* 투표 현황 */}
      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-muted border-b">
          <h2 className="text-sm font-semibold">투표 현황</h2>
          {detail.vote_summary && (
            <p className="text-xs text-muted-foreground mt-1">
              승인 {detail.vote_summary.approved} / 거부 {detail.vote_summary.rejected} / 미투표{' '}
              {detail.vote_summary.pending} (라인 {lineVotes.length}개 + 관리자 1)
            </p>
          )}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="px-4 py-2.5 text-left font-medium">구분</th>
              <th className="px-4 py-2.5 text-left font-medium">상태</th>
              <th className="px-4 py-2.5 text-left font-medium">투표자</th>
              <th className="px-4 py-2.5 text-left font-medium">사유</th>
              <th className="px-4 py-2.5 text-left font-medium">투표일</th>
            </tr>
          </thead>
          <tbody>
            {/* 라인별 투표 */}
            {lineVotes.map((vote) => (
              <tr
                key={vote.id}
                className={`border-t hover:bg-muted/50 ${
                  vote.line_id === user?.line_id ? 'bg-primary/5' : ''
                }`}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <VoteStatusIcon vote={vote} />
                    <span className="font-medium">{vote.line_name ?? vote.line_code ?? '-'}</span>
                    {vote.line_id === user?.line_id && isReviewer && !isAdmin && (
                      <span className="text-xs text-primary">(내 라인)</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <VoteStatusLabel vote={vote.vote} />
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {vote.voter_name ?? '-'}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate">
                  {vote.reason ?? '-'}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {vote.voted_at
                    ? new Date(vote.voted_at).toLocaleDateString('ko-KR')
                    : '-'}
                </td>
              </tr>
            ))}
            {/* 관리자 투표 */}
            {adminVote && (
              <tr
                className={`border-t hover:bg-muted/50 ${
                  isAdmin ? 'bg-primary/5' : ''
                }`}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <VoteStatusIcon vote={adminVote} />
                    <span className="font-medium">관리자</span>
                    {isAdmin && (
                      <span className="text-xs text-primary">(내 투표)</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <VoteStatusLabel vote={adminVote.vote} />
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {adminVote.voter_name ?? '-'}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate">
                  {adminVote.reason ?? '-'}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {adminVote.voted_at
                    ? new Date(adminVote.voted_at).toLocaleDateString('ko-KR')
                    : '-'}
                </td>
              </tr>
            )}
            {lineVotes.length === 0 && !adminVote && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  투표 레코드가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 투표 다이얼로그 */}
      <Dialog open={isVoteOpen} onOpenChange={setIsVoteOpen}>
        <DialogContent onClose={() => setIsVoteOpen(false)}>
          <DialogHeader>
            <DialogTitle>투표</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleVoteSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">투표 *</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="vote"
                    value="approve"
                    checked={voteChoice === 'approve'}
                    onChange={() => setVoteChoice('approve')}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-green-700 font-medium">승인</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="vote"
                    value="reject"
                    checked={voteChoice === 'reject'}
                    onChange={() => setVoteChoice('reject')}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-red-700 font-medium">거부</span>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                사유 {voteChoice === 'reject' ? '*' : '(선택)'}
              </label>
              <textarea
                value={voteReason}
                onChange={(e) => setVoteReason(e.target.value)}
                required={voteChoice === 'reject'}
                placeholder={
                  voteChoice === 'reject'
                    ? '거부 사유를 입력해 주세요.'
                    : '승인 코멘트 (선택)'
                }
                rows={3}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
              />
            </div>
            {voteError && <p className="text-red-600 text-sm">{voteError}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsVoteOpen(false)}
                disabled={voteMutation.isPending}
              >
                취소
              </Button>
              <Button type="submit" disabled={voteMutation.isPending}>
                {voteMutation.isPending ? '투표 중...' : '투표 제출'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
