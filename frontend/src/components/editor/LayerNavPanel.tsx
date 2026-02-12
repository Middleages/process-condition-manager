import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/useEditorStore'
import type { ProjectLayerData, ValidationError } from '@/types'
import { AlertTriangle } from 'lucide-react'
import { useMemo } from 'react'

interface Props {
  layers: ProjectLayerData[]
  validationErrors: ValidationError[]
  onLayerClick: (layerId: number) => void
}

export function LayerNavPanel({ layers, validationErrors, onLayerClick }: Props) {
  const activeLayerId = useEditorStore((s) => s.activeLayerId)
  const dirtyCells = useEditorStore((s) => s.dirtyCells)

  // Count errors per layer
  const errorsByLayer = useMemo(() => {
    const map = new Map<number, number>()
    for (const err of validationErrors) {
      map.set(err.layer_id, (map.get(err.layer_id) ?? 0) + 1)
    }
    return map
  }, [validationErrors])

  // Count dirty cells per layer
  const dirtyByLayer = useMemo(() => {
    const map = new Map<number, number>()
    for (const cell of dirtyCells.values()) {
      const layer = layers.find((l) => l.id === cell.projectLayerId)
      if (layer) {
        map.set(layer.layer_id, (map.get(layer.layer_id) ?? 0) + 1)
      }
    }
    return map
  }, [dirtyCells, layers])

  return (
    <div className="w-52 border-r bg-muted/20 flex flex-col shrink-0 overflow-hidden">
      <div className="px-3 py-2 border-b">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          레이어 ({layers.length})
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {layers.map((layer) => {
          const errCount = errorsByLayer.get(layer.layer_id) ?? 0
          const dirtyCount = dirtyByLayer.get(layer.layer_id) ?? 0
          const isActive = activeLayerId === layer.layer_id

          return (
            <button
              key={layer.id}
              className={cn(
                'w-full text-left px-3 py-2 text-sm border-b border-border/50 transition-colors flex items-center gap-2',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted/50'
              )}
              onClick={() => onLayerClick(layer.layer_id)}
            >
              <div className="flex-1 min-w-0">
                <div className="truncate">{layer.layer_name}</div>
                {layer.backbone_product_name && (
                  <div className="text-[10px] text-muted-foreground truncate">
                    ← {layer.backbone_product_name}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {dirtyCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-amber-400" title={`변경 ${dirtyCount}건`} />
                )}
                {errCount > 0 && (
                  <span className="flex items-center gap-0.5 text-destructive text-[10px]">
                    <AlertTriangle className="h-3 w-3" />
                    {errCount}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
