import type { ValidationError } from '@/types'
import { AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'

// 필터 타입: 전체 / 단일 레이어 / 크로스 레이어
type FilterType = 'all' | 'single' | 'cross'

interface Props {
  errors: ValidationError[]
  onErrorClick: (error: ValidationError) => void
}

export function ValidationPanel({ errors, onErrorClick }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [filter, setFilter] = useState<FilterType>('all')

  // 필터 조건에 따라 오류 목록을 필터링
  const filteredErrors = errors.filter((err) => {
    if (filter === 'single') return err.rule_type !== 'cross_layer'
    if (filter === 'cross') return err.rule_type === 'cross_layer'
    return true
  })

  if (collapsed) {
    return (
      <div
        className="h-8 border-t bg-destructive/5 flex items-center px-3 cursor-pointer hover:bg-destructive/10"
        onClick={() => setCollapsed(false)}
      >
        <AlertTriangle className="h-3.5 w-3.5 text-destructive mr-2" />
        <span className="text-xs font-medium text-destructive">
          오류 {errors.length}건
        </span>
      </div>
    )
  }

  return (
    <div className="h-40 border-t flex flex-col shrink-0">
      {/* 헤더: 제목 + 필터 버튼 + 닫기 */}
      <div className="h-8 bg-destructive/5 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
          <span className="text-xs font-medium text-destructive">
            검증 오류 ({filteredErrors.length}건{filter !== 'all' ? ` / 전체 ${errors.length}건` : ''})
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* 필터 버튼 그룹 */}
          <div className="flex items-center border border-border rounded overflow-hidden">
            <button
              onClick={() => setFilter('all')}
              className={`px-2 py-0.5 text-xs transition-colors ${
                filter === 'all'
                  ? 'bg-destructive text-white'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              전체
            </button>
            <button
              onClick={() => setFilter('single')}
              className={`px-2 py-0.5 text-xs border-l border-border transition-colors ${
                filter === 'single'
                  ? 'bg-destructive text-white'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              단일 레이어
            </button>
            <button
              onClick={() => setFilter('cross')}
              className={`px-2 py-0.5 text-xs border-l border-border transition-colors ${
                filter === 'cross'
                  ? 'bg-orange-500 text-white'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              크로스 레이어
            </button>
          </div>

          <button
            onClick={() => setCollapsed(true)}
            className="text-muted-foreground hover:text-foreground ml-1"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 오류 목록 */}
      <div className="flex-1 overflow-y-auto">
        {filteredErrors.map((err, i) => (
          <div
            key={`${err.layer_id}-${err.column_name}-${i}`}
            className="flex items-center gap-3 px-3 py-1.5 text-xs border-b border-border/50 hover:bg-muted/30 cursor-pointer"
            onClick={() => onErrorClick(err)}
          >
            <span className="text-muted-foreground w-28 shrink-0 truncate">
              {err.layer_name}
            </span>
            <span className="font-medium w-32 shrink-0 truncate">
              {err.display_name}
            </span>
            {/* 크로스 레이어 오류에는 Cross 배지 표시 */}
            {err.rule_type === 'cross_layer' && (
              <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700 border border-orange-200">
                Cross
              </span>
            )}
            <span className="text-destructive truncate">{err.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
