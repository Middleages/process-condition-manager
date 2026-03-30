import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Loader2, FileEdit, Eye, CheckCircle, XCircle, Clock, ArrowRight, FileCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useDashboardOverview, useRefreshDashboard } from '@/hooks/useDashboard'
import { useLines } from '@/hooks/useLines'
import { useConfigChanges } from '@/hooks/useConfigChanges'
import type { StatusCounts, MyRecentProject, ReviewPendingItem, ActivityItem } from '@/types'
import { formatDate } from '@/lib/utils'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  review: 'Review',
  approved: 'Approved',
  rejected: 'Rejected',
}

const STATUS_CARD_CONFIG: {
  key: keyof StatusCounts
  label: string
  icon: typeof FileEdit
  bg: string
  text: string
}[] = [
  { key: 'draft', label: 'Draft', icon: FileEdit, bg: 'bg-amber-50', text: 'text-amber-800' },
  { key: 'review', label: 'Review', icon: Eye, bg: 'bg-blue-50', text: 'text-blue-800' },
  { key: 'approved', label: 'Approved', icon: CheckCircle, bg: 'bg-green-50', text: 'text-green-800' },
  { key: 'rejected', label: 'Rejected', icon: XCircle, bg: 'bg-red-50', text: 'text-red-800' },
]


function StatusCards({
  counts,
  onClick,
}: {
  counts: StatusCounts
  onClick: (status: string) => void
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {STATUS_CARD_CONFIG.map(({ key, label, icon: Icon, bg, text }) => (
        <button
          key={key}
          onClick={() => onClick(key)}
          className={`${bg} rounded-lg p-5 text-left transition-shadow hover:shadow-md cursor-pointer border-0`}
        >
          <div className={`flex items-center justify-between ${text}`}>
            <Icon className="h-5 w-5" />
            <span className="text-2xl font-bold">{counts[key]}</span>
          </div>
          <p className={`mt-2 text-sm font-medium ${text}`}>{label}</p>
        </button>
      ))}
    </div>
  )
}

function MyRecentProjects({ projects }: { projects: MyRecentProject[] }) {
  const navigate = useNavigate()

  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">프로젝트가 없습니다.</p>
  }

  return (
    <div className="space-y-2">
      {projects.map((p) => (
        <div
          key={p.id}
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/projects/${p.id}/edit`)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/projects/${p.id}/edit`) } }}
          className="flex items-center justify-between p-3 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{p.product_name}</p>
            <p className="text-xs text-muted-foreground">
              v{p.revision} · {p.changed_cells_count}건 변경 · {formatDate(p.updated_at)}
            </p>
          </div>
          <Badge variant={p.status as 'draft' | 'review' | 'approved' | 'rejected'} className="ml-3 shrink-0">
            {STATUS_LABELS[p.status] || p.status}
          </Badge>
        </div>
      ))}
    </div>
  )
}

function ReviewPendingList({ items }: { items: ReviewPendingItem[] }) {
  const navigate = useNavigate()

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">검토 대기 항목이 없습니다.</p>
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/projects/${item.id}/edit`)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/projects/${item.id}/edit`) } }}
          className="flex items-center justify-between p-3 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{item.product_name}</p>
            <p className="text-xs text-muted-foreground">
              {item.creator_userid} · {item.changed_cells_count}건 변경
            </p>
          </div>
          <span className="text-xs text-muted-foreground ml-3 shrink-0">
            {formatDate(item.review_requested_at)}
          </span>
        </div>
      ))}
    </div>
  )
}

function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">최근 활동이 없습니다.</p>
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-3 p-3 rounded-md">
          <div className="mt-0.5">
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-medium">{item.changer_userid}</span>
              {' '}
              <span className="text-muted-foreground">님이</span>
              {' '}
              <span className="font-medium">{item.product_name}</span>
              {' '}
              <span className="text-muted-foreground">프로젝트를</span>
              {' '}
              <Badge variant={item.from_status as 'draft' | 'review' | 'approved' | 'rejected'} className="text-[10px] px-1.5 py-0">
                {STATUS_LABELS[item.from_status] || item.from_status}
              </Badge>
              {' '}
              <ArrowRight className="inline h-3 w-3 text-muted-foreground" />
              {' '}
              <Badge variant={item.to_status as 'draft' | 'review' | 'approved' | 'rejected'} className="text-[10px] px-1.5 py-0">
                {STATUS_LABELS[item.to_status] || item.to_status}
              </Badge>
              {' '}
              <span className="text-muted-foreground">(으)로 변경</span>
            </p>
            {item.comment && (
              <p className="text-xs text-muted-foreground mt-1 truncate">"{item.comment}"</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">{formatDate(item.changed_at)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function ConfigChangeSummary({
  onStatusClick,
}: {
  onStatusClick: (status: string) => void
}) {
  const pending = useConfigChanges('pending', 0, 1)
  const approved = useConfigChanges('approved', 0, 1)
  const inProgress = useConfigChanges('in_progress', 0, 1)
  const completed = useConfigChanges('completed', 0, 1)

  const items: { status: string; label: string; count: number; dot: string }[] = [
    { status: 'pending', label: '투표 대기', count: pending.data?.total ?? 0, dot: 'bg-amber-500' },
    { status: 'approved', label: '승인 완료', count: approved.data?.total ?? 0, dot: 'bg-blue-500' },
    { status: 'in_progress', label: '작업 진행', count: inProgress.data?.total ?? 0, dot: 'bg-indigo-500' },
    { status: 'completed', label: '적용 완료', count: completed.data?.total ?? 0, dot: 'bg-green-500' },
  ]

  return (
    <div className="flex items-center gap-6">
      {items.map(({ status, label, count, dot }) => (
        <button
          key={status}
          onClick={() => onStatusClick(status)}
          className="flex items-center gap-2 hover:opacity-70 transition-opacity"
        >
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-lg font-bold">{count}</span>
        </button>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const [lineFilter, setLineFilter] = useState<number | undefined>(undefined)
  const { data: lines = [] } = useLines()
  const { data, isLoading, isError } = useDashboardOverview(lineFilter)
  const refresh = useRefreshDashboard()
  const navigate = useNavigate()

  const handleStatusClick = (status: string) => {
    const params = new URLSearchParams({ status })
    if (lineFilter) params.set('line_id', String(lineFilter))
    navigate(`/projects?${params.toString()}`)
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <select
            value={lineFilter ?? ''}
            onChange={(e) => setLineFilter(e.target.value ? Number(e.target.value) : undefined)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">전체 라인</option>
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.line_name}
              </option>
            ))}
          </select>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-1" />
          )}
          새로고침
        </Button>
      </div>

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          데이터를 불러오는 중 오류가 발생했습니다. 새로고침을 시도해주세요.
        </div>
      )}

      {isLoading && !data && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {data && (
        <>
          <StatusCards counts={data.status_counts} onClick={handleStatusClick} />

          {/* 설정 변경 요청 요약 */}
          <div className="rounded-lg border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <FileCheck className="h-4 w-4" />
                설정 변경 요청
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/config-changes')}
                className="text-xs"
              >
                전체 보기
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
            <ConfigChangeSummary onStatusClick={(s) => navigate(`/config-changes?status=${s}`)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-base font-semibold mb-3">내 최근 프로젝트</h2>
              <MyRecentProjects projects={data.my_recent_projects} />
            </div>

            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-base font-semibold mb-3">검토 대기</h2>
              <ReviewPendingList items={data.review_pending} />
            </div>
          </div>

          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-base font-semibold mb-3">최근 활동</h2>
            <ActivityTimeline items={data.recent_activity} />
          </div>
        </>
      )}
    </div>
  )
}
