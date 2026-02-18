import { Loader2 } from 'lucide-react'
import type { ExportPreview } from '@/types/export'

// 미리보기에 표시할 최대 행 수
const MAX_PREVIEW_ROWS = 5

interface ExportPreviewTableProps {
  preview: ExportPreview | null
  isLoading: boolean
}

export function ExportPreviewTable({ preview, isLoading }: ExportPreviewTableProps) {
  // 로딩 상태
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">미리보기 불러오는 중...</span>
      </div>
    )
  }

  // 미리보기 미선택 상태
  if (!preview) {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
        시스템의 눈 아이콘을 클릭하면 미리보기를 확인할 수 있습니다.
      </div>
    )
  }

  const displayRows = preview.rows.slice(0, MAX_PREVIEW_ROWS)

  return (
    <div className="mt-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800">{preview.system_name}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
            {preview.format_type}
          </span>
        </div>
        <span className="text-xs text-gray-500">
          {displayRows.length} / {preview.total_rows}행 표시
        </span>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto border border-gray-200 rounded">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {preview.headers.map((header, idx) => (
                <th
                  key={idx}
                  className="px-2 py-1.5 text-left font-medium text-gray-600 whitespace-nowrap border-r border-gray-200 last:border-r-0"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td
                  colSpan={preview.headers.length}
                  className="px-2 py-4 text-center text-gray-400"
                >
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              displayRows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  {preview.headers.map((header, colIdx) => (
                    <td
                      key={colIdx}
                      className="px-2 py-1.5 whitespace-nowrap border-r border-gray-100 last:border-r-0 text-gray-700"
                    >
                      {String(row[header] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {preview.total_rows > MAX_PREVIEW_ROWS && (
        <p className="mt-1 text-xs text-gray-400 text-right">
          전체 {preview.total_rows}행 중 {MAX_PREVIEW_ROWS}행만 표시됩니다.
        </p>
      )}
    </div>
  )
}
