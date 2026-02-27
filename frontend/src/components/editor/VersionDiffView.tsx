import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { VersionDiffResponse, LayerDiff, CellDiff } from '@/types'

interface Props {
  diff: VersionDiffResponse
  /** 셀 행 클릭 시 호출되는 콜백 */
  onCellClick?: (layerId: string, columnName: string) => void
}

// 변경 유형별 배지 스타일
const changeTypeBadge: Record<LayerDiff['change_type'], { label: string; cls: string }> = {
  modified: { label: '수정', cls: 'bg-yellow-100 text-yellow-800' },
  added:    { label: '추가', cls: 'bg-green-100 text-green-800' },
  removed:  { label: '제거', cls: 'bg-red-100 text-red-800' },
}

// 변경 유형별 행 배경색
const rowBg: Record<LayerDiff['change_type'], string> = {
  modified: '',
  added:    'bg-green-50',
  removed:  'bg-red-50',
}

// 셀 값 표시 - null 이면 "-"
function displayValue(val: string | null): string {
  if (val === null || val === undefined) return '-'
  return val
}

interface LayerSectionProps {
  layerDiff: LayerDiff
  onCellClick?: (layerId: string, columnName: string) => void
}

function LayerSection({ layerDiff, onCellClick }: LayerSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const badge = changeTypeBadge[layerDiff.change_type]
  const bg = rowBg[layerDiff.change_type]

  return (
    <div className="border border-border rounded mb-2 overflow-hidden">
      {/* 레이어 헤더 - 클릭하면 접기/펼치기 */}
      <button
        type="button"
        className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left hover:bg-muted/50 ${bg}`}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}

        {/* 레이어명 */}
        <span className="flex-1 text-foreground">{layerDiff.layer_name}</span>

        {/* 변경 유형 배지 */}
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.cls}`}>
          {badge.label}
        </span>

        {/* 변경 셀 수 */}
        <span className="text-muted-foreground font-normal">
          {layerDiff.changes.length}개 셀
        </span>
      </button>

      {/* 펼쳤을 때 - 컬럼별 diff 테이블 */}
      {expanded && (
        <div className="border-t border-border">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-muted/40">
                <th className="px-3 py-1 text-left font-medium text-muted-foreground w-1/3">
                  컬럼명
                </th>
                <th className="px-3 py-1 text-left font-medium text-muted-foreground w-1/3">
                  이전 값
                </th>
                <th className="px-3 py-1 text-left font-medium text-muted-foreground w-1/3">
                  변경 값
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {layerDiff.changes.map((cell: CellDiff) => (
                <tr
                  key={cell.column_name}
                  className={`hover:bg-muted/30 ${onCellClick ? 'cursor-pointer' : ''}`}
                  onClick={() => onCellClick?.(layerDiff.layer_id, cell.column_name)}
                >
                  <td className="px-3 py-1 font-mono text-foreground">
                    {cell.column_name}
                  </td>
                  <td className="px-3 py-1 text-red-600">
                    {displayValue(cell.old_value)}
                  </td>
                  <td className="px-3 py-1 text-green-700">
                    {displayValue(cell.new_value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function VersionDiffView({ diff, onCellClick }: Props) {
  // 변경 사항이 없는 경우
  if (diff.layers.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground text-center">
        두 버전 사이에 변경된 내용이 없습니다.
      </div>
    )
  }

  return (
    <div className="p-3">
      {/* 요약 헤더 */}
      <div className="flex items-center gap-3 mb-3 text-[11px] text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">
            v{diff.base_revision}
          </span>
          {' → '}
          <span className="font-semibold text-foreground">
            v{diff.compare_revision}
          </span>
        </span>
        <span className="text-border">|</span>
        <span>
          레이어{' '}
          <span className="font-semibold text-foreground">
            {diff.summary.total_layers_changed}
          </span>
          개 변경
        </span>
        <span className="text-border">|</span>
        <span>
          셀{' '}
          <span className="font-semibold text-foreground">
            {diff.summary.total_cells_changed}
          </span>
          개 변경
        </span>
      </div>

      {/* 레이어별 diff 섹션 (기본: 접힘) */}
      <div>
        {diff.layers.map((layerDiff) => (
          <LayerSection
            key={layerDiff.layer_id}
            layerDiff={layerDiff}
            onCellClick={onCellClick}
          />
        ))}
      </div>
    </div>
  )
}
