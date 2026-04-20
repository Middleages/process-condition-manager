import { cn } from '@/lib/utils'
import { getLayerChangeCount } from '@/lib/diff'
import { useEditorStore } from '@/stores/useEditorStore'
import type { ProjectLayerData, ValidationError } from '@/types'
import { AlertTriangle, GitCompare, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  layer: ProjectLayerData | null
}

interface Props {
  layers: ProjectLayerData[]
  validationErrors: ValidationError[]
  isDraft: boolean
  onLayerClick: (layerKey: string) => void
  onBackboneReplace?: (layer: ProjectLayerData) => void
  onLayerAdd?: () => void
  onLayerDelete?: (layer: ProjectLayerData) => void
}

export function LayerNavPanel({
  layers,
  validationErrors,
  isDraft,
  onLayerClick,
  onBackboneReplace,
  onLayerAdd,
  onLayerDelete,
}: Props) {
  const makeLayerKey = (layer: ProjectLayerData) => `${layer.layer_id}::${layer.step_seq}`
  const activeLayerId = useEditorStore((s) => s.activeLayerId)
  const dirtyCells = useEditorStore((s) => s.dirtyCells)
  const panelRef = useRef<HTMLDivElement>(null)

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    layer: null,
  })

  // Count errors per layer
  const errorsByLayer = useMemo(() => {
    const map = new Map<string, number>()
    for (const err of validationErrors) {
      map.set(err.layer_id, (map.get(err.layer_id) ?? 0) + 1)
    }
    return map
  }, [validationErrors])

  // Count dirty cells per layer (unsaved edits)
  const dirtyByLayer = useMemo(() => {
    const map = new Map<string, number>()
    for (const cell of dirtyCells.values()) {
      const layer = layers.find((l) => l.id === cell.projectLayerId)
      if (layer) {
        map.set(layer.layer_id, (map.get(layer.layer_id) ?? 0) + 1)
      }
    }
    return map
  }, [dirtyCells, layers])

  // Backbone diff count per layer (saved changes vs backbone)
  const backboneDiffByLayer = useMemo(() => {
    const map = new Map<string, number>()
    for (const layer of layers) {
      const count = getLayerChangeCount(layer)
      if (count > 0) {
        map.set(layer.layer_id, count)
      }
    }
    return map
  }, [layers])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, layer: ProjectLayerData) => {
      if (!isDraft) return
      e.preventDefault()
      // Use fixed positioning with raw clientX/clientY so the menu
      // is not clipped by overflow-hidden on the panel.
      const menuWidth = 180
      const menuHeight = 90
      const x = Math.min(e.clientX, window.innerWidth - menuWidth)
      const y = Math.min(e.clientY, window.innerHeight - menuHeight)
      setContextMenu({
        visible: true,
        x,
        y,
        layer,
      })
    },
    [isDraft]
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }))
  }, [])

  return (
    <div
      ref={panelRef}
      className="w-52 border-r bg-muted/20 flex flex-col shrink-0 overflow-hidden relative"
      onClick={closeContextMenu}
    >
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          레이어 ({layers.length})
        </h3>
        {isDraft && onLayerAdd && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onLayerAdd()
            }}
            className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="레이어 추가"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {layers.map((layer) => {
          const errCount = errorsByLayer.get(layer.layer_id) ?? 0
          const dirtyCount = dirtyByLayer.get(layer.layer_id) ?? 0
          const bbDiffCount = backboneDiffByLayer.get(layer.layer_id) ?? 0
          const layerKey = makeLayerKey(layer)
          const isActive = activeLayerId === layerKey

          return (
            <button
              key={layer.id}
              className={cn(
                'w-full text-left px-3 py-2 text-sm border-b border-border/50 transition-colors flex items-center gap-2',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted/50'
              )}
              onClick={() => onLayerClick(layerKey)}
              onContextMenu={(e) => handleContextMenu(e, layer)}
            >
              <div className="flex-1 min-w-0">
                <div className="truncate">{layer.layer_name}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {layer.layer_id} · {layer.step_seq}
                </div>
                {layer.backbone_condition_name && (
                  <div className="text-[10px] text-muted-foreground truncate">
                    &larr; {layer.backbone_condition_name}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {dirtyCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-amber-400" title={`미저장 ${dirtyCount}건`} />
                )}
                {bbDiffCount > 0 && (
                  <span
                    className="flex items-center gap-0.5 text-blue-500 text-[10px]"
                    title={`Backbone 대비 ${bbDiffCount}건 변경`}
                  >
                    <GitCompare className="h-3 w-3" />
                    {bbDiffCount}
                  </span>
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

      {/* Context menu - uses fixed positioning to avoid overflow-hidden clipping */}
      {contextMenu.visible && contextMenu.layer && (
        <div
          className="fixed bg-popover border rounded-md shadow-md py-1 z-50 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
            onClick={() => {
              if (contextMenu.layer) onBackboneReplace?.(contextMenu.layer)
              closeContextMenu()
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Backbone 교체
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2 text-destructive"
            onClick={() => {
              if (contextMenu.layer) onLayerDelete?.(contextMenu.layer)
              closeContextMenu()
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            레이어 삭제
          </button>
        </div>
      )}
    </div>
  )
}
