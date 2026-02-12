import { useState } from 'react'
import { useChangeLogs } from '@/hooks/useProjects'
import type { ProjectLayerData } from '@/types'
import { History, ChevronDown, ChevronUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  projectId: number
  layers: ProjectLayerData[]
}

export function ChangeHistoryPanel({ projectId, layers }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [filterLayerId, setFilterLayerId] = useState<number | undefined>()
  const [filterColumn, setFilterColumn] = useState<string | undefined>()

  const { data, isLoading } = useChangeLogs(projectId, {
    layer_id: filterLayerId,
    column_name: filterColumn,
    limit: 50,
  })

  if (!isOpen) {
    return (
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground border-t bg-muted/30 hover:bg-muted/50 transition-colors w-full"
        onClick={() => setIsOpen(true)}
      >
        <History className="h-3.5 w-3.5" />
        변경 이력
        <ChevronUp className="h-3 w-3 ml-auto" />
      </button>
    )
  }

  return (
    <div className="border-t flex flex-col h-56 shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b">
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">
          변경 이력 {data ? `(${data.total}건)` : ''}
        </span>

        {/* Filters */}
        <select
          className="text-xs border rounded px-1.5 py-0.5 bg-background ml-2"
          value={filterLayerId ?? ''}
          onChange={(e) => setFilterLayerId(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">전체 레이어</option>
          {layers.map((l) => (
            <option key={l.layer_id} value={l.layer_id}>
              {l.layer_name}
            </option>
          ))}
        </select>

        {filterColumn && (
          <span className="flex items-center gap-1 text-xs bg-primary/10 text-primary rounded px-1.5 py-0.5">
            {filterColumn}
            <button onClick={() => setFilterColumn(undefined)}>
              <X className="h-3 w-3" />
            </button>
          </span>
        )}

        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={() => setIsOpen(false)}
        >
          <ChevronDown className="h-3 w-3" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            로딩 중...
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            변경 이력이 없습니다.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/30 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium w-28">시간</th>
                <th className="text-left px-2 py-1.5 font-medium w-24">레이어</th>
                <th className="text-left px-2 py-1.5 font-medium w-28">컬럼</th>
                <th className="text-left px-2 py-1.5 font-medium">이전값</th>
                <th className="text-left px-2 py-1.5 font-medium">새값</th>
                <th className="text-left px-2 py-1.5 font-medium w-16">유형</th>
                <th className="text-left px-2 py-1.5 font-medium w-20">사용자</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-border/30 hover:bg-muted/20"
                >
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {new Date(log.changed_at).toLocaleString('ko-KR', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="px-2 py-1.5">{log.layer_name}</td>
                  <td
                    className="px-2 py-1.5 cursor-pointer text-primary hover:underline"
                    onClick={() => setFilterColumn(log.column_name)}
                  >
                    {log.column_name}
                  </td>
                  <td className="px-2 py-1.5 text-destructive/70 line-through">
                    {log.old_value ?? '(없음)'}
                  </td>
                  <td className="px-2 py-1.5 text-green-600 font-medium">
                    {log.new_value ?? '(없음)'}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`px-1 py-0.5 rounded text-[10px] ${
                      log.change_type === 'manual'
                        ? 'bg-blue-100 text-blue-700'
                        : log.change_type === 'backbone'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-green-100 text-green-700'
                    }`}>
                      {log.change_type}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {log.changed_by_name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
