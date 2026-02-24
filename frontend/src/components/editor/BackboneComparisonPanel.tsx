import { GitCompare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BackboneComparisonView } from './BackboneComparisonView'
import type { ProjectLayerData, ColumnCategory } from '@/types'

interface Props {
  layers: ProjectLayerData[]
  categories: ColumnCategory[]
  isOpen: boolean
  onClose: () => void
  onNavigateToCell?: (layerName: string, columnName: string) => void
}

export function BackboneComparisonPanel({
  layers,
  categories,
  isOpen,
  onClose,
  onNavigateToCell,
}: Props) {
  if (!isOpen) return null

  const handleCellClick = (layerId: number, columnName: string) => {
    const layer = layers.find((l) => l.layer_id === layerId)
    if (layer && onNavigateToCell) {
      onNavigateToCell(layer.layer_name, columnName)
    }
  }

  return (
    <div className="w-[420px] border-l border-border bg-background flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GitCompare className="h-4 w-4 text-blue-500" />
          Backbone 비교
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <BackboneComparisonView
          layers={layers}
          categories={categories}
          onCellClick={handleCellClick}
        />
      </div>
    </div>
  )
}
