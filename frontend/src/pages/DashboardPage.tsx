import { useNavigate } from 'react-router-dom'
import { RefreshCw, Loader2, FileEdit, Eye, CheckCircle, XCircle, Clock, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useDashboardOverview, useRefreshDashboard } from '@/hooks/useDashboard'
import type { StatusCounts, MyRecentProject, ReviewPendingItem, ActivityItem } from '@/types'

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

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

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
          onClick={() => navigate(`/projects/${p.id}/edit`)}
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
          onClick={() => navigate(`/projects/${item.id}/edit`)}
          className="flex items-center justify-between p-3 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{item.product_name}</p>
            <p className="text-xs text-muted-foreground">
              {item.creator_name} · {item.changed_cells_count}건 변경
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
              <span className="font-medium">{item.changer_name}</span>
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

export default function DashboardPage() {
  const { data, isLoading, isError } = useDashboardOverview()
  const refresh = useRefreshDashboard()
  const navigate = useNavigate()

  const handleStatusClick = (status: string) => {
    navigate(`/projects?status=${status}`)
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
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
