import { useStatusHistory } from '@/hooks/useComments'
import { ArrowRight, Clock, Loader2 } from 'lucide-react'

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  review: 'Review',
  approved: 'Approved',
  rejected: 'Rejected',
  archived: 'Archived',
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Props {
  projectId: number
}

export function StatusTimeline({ projectId }: Props) {
  const { data, isLoading } = useStatusHistory(projectId)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        상태 이력 로딩 중...
      </div>
    )
  }

  const history = data?.history ?? []

  if (history.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        상태 변경 이력이 없습니다.
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4">
      <h3 className="text-sm font-semibold flex items-center gap-1.5">
        <Clock className="h-4 w-4" />
        상태 변경 이력
      </h3>
      <div className="space-y-2">
        {history.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-3 text-sm border-l-2 border-muted pl-3 py-1"
          >
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                {item.from_status ? (
                  <>
                    <span className="font-medium">{statusLabels[item.from_status] ?? item.from_status}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{statusLabels[item.to_status] ?? item.to_status}</span>
                  </>
                ) : (
                  <span className="font-medium">{statusLabels[item.to_status] ?? item.to_status}</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {item.changer_name} · {formatDate(item.changed_at)}
              </div>
              {item.comment && (
                <div className="text-xs mt-1 text-muted-foreground italic">
                  &quot;{item.comment}&quot;
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
