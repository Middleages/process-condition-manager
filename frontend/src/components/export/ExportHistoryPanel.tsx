import { Loader2 } from 'lucide-react'
import { useExportHistory } from '@/hooks/useExportHistory'
import type { ExportHistory } from '@/types/export'

interface ExportHistoryPanelProps {
  projectId: number
}

// 날짜 포맷: "2024-01-15 09:30" 형식
function formatDate(isoString: string): string {
  const date = new Date(isoString)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}`
}

// 출력 유형 한글 레이블
function getExportTypeLabel(exportType: ExportHistory['export_type']): string {
  return exportType === 'bulk' ? '벌크' : '단건'
}

export function ExportHistoryPanel({ projectId }: ExportHistoryPanelProps) {
  const { data, isLoading, loadMore, hasMore } = useExportHistory(projectId)

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        출력 이력
      </h4>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="ml-2 text-xs text-muted-foreground">불러오는 중...</span>
        </div>
      ) : !data || data.items.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">
          출력 이력이 없습니다
        </p>
      ) : (
        <>
          <ul className="space-y-1">
            {data.items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-600 hover:bg-gray-50"
              >
                <span className="font-medium text-gray-800 truncate max-w-[100px]">
                  {item.exported_by_name}
                </span>
                <span className="text-gray-300">|</span>
                <span className="truncate flex-1">{item.system_name}</span>
                <span className="text-gray-300">|</span>
                <span className="text-gray-500 shrink-0">{formatDate(item.exported_at)}</span>
                <span className="text-gray-300">|</span>
                <span
                  className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                    item.export_type === 'bulk'
                      ? 'bg-blue-50 text-blue-600'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {getExportTypeLabel(item.export_type)}
                </span>
              </li>
            ))}
          </ul>

          {hasMore && (
            <div className="flex justify-center mt-2">
              <button
                type="button"
                onClick={loadMore}
                className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded hover:bg-gray-100 transition-colors"
              >
                더 보기
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
