import type { ValidationError } from '@/types'
import { AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'

interface Props {
  errors: ValidationError[]
  onErrorClick: (error: ValidationError) => void
}

export function ValidationPanel({ errors, onErrorClick }: Props) {
  const [collapsed, setCollapsed] = useState(false)

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
      <div className="h-8 bg-destructive/5 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
          <span className="text-xs font-medium text-destructive">
            검증 오류 ({errors.length}건)
          </span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {errors.map((err, i) => (
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
            <span className="text-destructive truncate">{err.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
