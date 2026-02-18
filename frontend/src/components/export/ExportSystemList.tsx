import { Download, Eye, FileSpreadsheet } from 'lucide-react'
import type { ExportSystem } from '@/types/export'

// 포맷 타입별 뱃지 스타일
const FORMAT_BADGE_STYLES: Record<string, { label: string; className: string }> = {
  TYPE_A: {
    label: 'Type A',
    className: 'bg-blue-100 text-blue-700 border border-blue-200',
  },
  TYPE_B: {
    label: 'Type B',
    className: 'bg-green-100 text-green-700 border border-green-200',
  },
  TYPE_C: {
    label: 'Type C',
    className: 'bg-purple-100 text-purple-700 border border-purple-200',
  },
}

interface ExportSystemListProps {
  systems: ExportSystem[]
  selectedIds: number[]
  onToggle: (systemId: number) => void
  onPreview: (systemId: number) => void
  onDownloadSingle: (systemId: number) => void
  downloadingId: number | null
}

export function ExportSystemList({
  systems,
  selectedIds,
  onToggle,
  onPreview,
  onDownloadSingle,
  downloadingId,
}: ExportSystemListProps) {
  if (systems.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        등록된 전산 출력 시스템이 없습니다.
      </div>
    )
  }

  return (
    <ul className="space-y-1">
      {systems.map((system) => {
        const isDisabled = system.column_count === 0
        const isSelected = selectedIds.includes(system.id)
        const badge = FORMAT_BADGE_STYLES[system.format_type] ?? {
          label: system.format_type,
          className: 'bg-gray-100 text-gray-700 border border-gray-200',
        }
        const isDownloading = downloadingId === system.id

        return (
          <li
            key={system.id}
            className={`flex items-center gap-3 px-3 py-2 rounded border ${
              isDisabled
                ? 'bg-gray-50 border-gray-100 opacity-60'
                : 'bg-white border-gray-200 hover:border-gray-300'
            }`}
          >
            {/* 체크박스 */}
            <div title={isDisabled ? '컬럼 매핑이 설정되지 않았습니다' : undefined}>
              <input
                type="checkbox"
                checked={isSelected}
                disabled={isDisabled}
                onChange={() => !isDisabled && onToggle(system.id)}
                className="h-4 w-4 rounded border-gray-300 text-primary cursor-pointer disabled:cursor-not-allowed"
              />
            </div>

            {/* 시스템 아이콘 */}
            <FileSpreadsheet className="h-4 w-4 text-gray-400 shrink-0" />

            {/* 시스템 정보 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-medium ${isDisabled ? 'text-gray-400' : 'text-gray-900'}`}>
                  {system.system_name}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.className}`}>
                  {badge.label}
                </span>
                <span className="text-xs text-gray-400">
                  {system.column_count}개 컬럼
                </span>
              </div>
              {system.description && (
                <p className="text-xs text-gray-500 truncate mt-0.5">{system.description}</p>
              )}
              {isDisabled && (
                <p className="text-xs text-red-400 mt-0.5">컬럼 매핑이 설정되지 않았습니다</p>
              )}
            </div>

            {/* 미리보기 버튼 */}
            <button
              type="button"
              onClick={() => onPreview(system.id)}
              disabled={isDisabled}
              title="미리보기"
              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Eye className="h-4 w-4" />
            </button>

            {/* 단건 다운로드 버튼 */}
            <button
              type="button"
              onClick={() => !isDisabled && !isDownloading && onDownloadSingle(system.id)}
              disabled={isDisabled || isDownloading}
              title="개별 다운로드"
              className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isDownloading ? (
                <span className="h-4 w-4 block border-2 border-gray-300 border-t-green-500 rounded-full animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
