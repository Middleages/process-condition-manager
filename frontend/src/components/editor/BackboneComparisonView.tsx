import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import type { ProjectLayerData, ColumnCategory } from '@/types'
import { computeProjectComparisonDetail } from '@/lib/diff'
import type { LayerComparisonDetail, CellChange } from '@/lib/diff'

interface Props {
  layers: ProjectLayerData[]
  categories?: ColumnCategory[]
  /** Called when user clicks a cell row to navigate to it */
  onCellClick?: (layerId: number, columnName: string) => void
  /** Compact mode for embedding in modals */
  compact?: boolean
}

function displayValue(val: string | null): string {
  return val === null ? '-' : val
}

/** Resolve column display_name from categories */
function getColumnDisplayName(
  columnName: string,
  categories?: ColumnCategory[]
): string {
  if (!categories) return columnName
  for (const cat of categories) {
    const col = cat.columns.find((c) => c.column_name === columnName)
    if (col) return col.display_name
  }
  return columnName
}

/** Get category code for a column */
function getColumnCategory(
  columnName: string,
  categories?: ColumnCategory[]
): string | null {
  if (!categories) return null
  for (const cat of categories) {
    if (cat.columns.some((c) => c.column_name === columnName)) {
      return cat.category_code
    }
  }
  return null
}

const categoryColors: Record<string, string> = {
  SP: 'bg-blue-100 text-blue-700',
  SC: 'bg-purple-100 text-purple-700',
  OVL: 'bg-amber-100 text-amber-700',
  DEV: 'bg-emerald-100 text-emerald-700',
}

interface LayerSectionProps {
  detail: LayerComparisonDetail
  categories?: ColumnCategory[]
  onCellClick?: (layerId: number, columnName: string) => void
  defaultExpanded?: boolean
  searchQuery?: string
}

function LayerSection({ detail, categories, onCellClick, defaultExpanded = false, searchQuery = '' }: LayerSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const filteredChanges = useMemo(() => {
    if (!searchQuery) return detail.changes
    const q = searchQuery.toLowerCase()
    return detail.changes.filter((c) => {
      const displayName = getColumnDisplayName(c.columnName, categories)
      return (
        c.columnName.toLowerCase().includes(q) ||
        displayName.toLowerCase().includes(q) ||
        (c.backboneValue?.toLowerCase().includes(q) ?? false) ||
        (c.currentValue?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [detail.changes, searchQuery, categories])

  if (searchQuery && filteredChanges.length === 0) return null

  return (
    <div className="border border-border rounded mb-2 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left hover:bg-muted/50"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}

        <span className="text-muted-foreground text-[10px] font-mono w-8">
          {detail.stepSeq}
        </span>

        <span className="flex-1 text-foreground">{detail.layerName}</span>

        {detail.backboneProductName && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
            BB: {detail.backboneProductName}
          </span>
        )}

        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-100 text-yellow-800">
          {filteredChanges.length}개 변경
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-muted/40">
                {categories && (
                  <th className="px-2 py-1 text-left font-medium text-muted-foreground w-12">
                    분류
                  </th>
                )}
                <th className="px-3 py-1 text-left font-medium text-muted-foreground">
                  컬럼명
                </th>
                <th className="px-3 py-1 text-left font-medium text-muted-foreground w-1/4">
                  Backbone 값
                </th>
                <th className="px-3 py-1 text-left font-medium text-muted-foreground w-1/4">
                  현재 값
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredChanges.map((cell: CellChange) => {
                const catCode = getColumnCategory(cell.columnName, categories)
                return (
                  <tr
                    key={cell.columnName}
                    className={`hover:bg-muted/30 ${onCellClick ? 'cursor-pointer' : ''}`}
                    onClick={() => onCellClick?.(detail.layerId, cell.columnName)}
                  >
                    {categories && (
                      <td className="px-2 py-1">
                        {catCode && (
                          <span className={`px-1 py-0.5 rounded text-[9px] font-semibold ${categoryColors[catCode] ?? 'bg-gray-100 text-gray-700'}`}>
                            {catCode}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-1 font-mono text-foreground">
                      {getColumnDisplayName(cell.columnName, categories)}
                    </td>
                    <td className="px-3 py-1 text-red-600 font-mono">
                      {displayValue(cell.backboneValue)}
                    </td>
                    <td className="px-3 py-1 text-green-700 font-mono">
                      {displayValue(cell.currentValue)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function BackboneComparisonView({ layers, categories, onCellClick, compact = false }: Props) {
  const [searchQuery, setSearchQuery] = useState('')

  const comparison = useMemo(
    () => computeProjectComparisonDetail(layers),
    [layers]
  )

  if (comparison.totalChangedCells === 0) {
    return (
      <div className={`text-xs text-muted-foreground text-center ${compact ? 'py-3' : 'px-3 py-6'}`}>
        Backbone 대비 변경된 내용이 없습니다.
      </div>
    )
  }

  return (
    <div className={compact ? '' : 'p-3'}>
      {/* Summary header */}
      <div className="flex items-center gap-3 mb-3 text-[11px] text-muted-foreground">
        <span>
          변경 레이어{' '}
          <span className="font-semibold text-foreground">
            {comparison.totalChangedLayers}
          </span>
          <span className="text-muted-foreground"> / {comparison.totalLayers}</span>
        </span>
        <span className="text-border">|</span>
        <span>
          변경 셀{' '}
          <span className="font-semibold text-foreground">
            {comparison.totalChangedCells}
          </span>
          개
        </span>
      </div>

      {/* Search */}
      {!compact && (
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="컬럼명 또는 값 검색..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-input rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-ring"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {/* Layer sections */}
      <div className={compact ? 'max-h-[400px] overflow-y-auto' : ''}>
        {comparison.layers.map((detail) => (
          <LayerSection
            key={detail.layerId}
            detail={detail}
            categories={categories}
            onCellClick={onCellClick}
            searchQuery={searchQuery}
          />
        ))}
      </div>
    </div>
  )
}
