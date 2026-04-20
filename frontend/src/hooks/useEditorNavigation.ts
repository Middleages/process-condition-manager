import { useCallback } from 'react'
import { useEditorStore } from '@/stores/useEditorStore'
import type { ColumnCategory, ColumnDefinition, ProjectLayerData, ValidationError, ProjectDetail } from '@/types'

interface UseEditorNavigationProps {
  project: ProjectDetail | undefined
  categories: ColumnCategory[]
}

const makeLayerKey = (layerId: string, stepSeq: string | null | undefined) => `${layerId}::${stepSeq ?? ''}`

export function useEditorNavigation({ project, categories }: UseEditorNavigationProps) {
  const setActiveLayerId = useEditorStore((s) => s.setActiveLayerId)
  const setActiveColumnName = useEditorStore((s) => s.setActiveColumnName)

  const handleLayerClick = useCallback(
    (layerId: string) => {
      setActiveLayerId(layerId)
      setActiveColumnName(null)
    },
    [setActiveLayerId, setActiveColumnName]
  )

  const handleErrorClick = useCallback(
    (error: ValidationError) => {
      setActiveColumnName(null)
      const targetLayer = project?.layers.find(
        (l) => l.layer_id === error.layer_id && l.layer_name === error.layer_name
      ) ?? project?.layers.find((l) => l.layer_id === error.layer_id)

      for (const cat of categories) {
        const col = cat.columns.find((c: ColumnDefinition) => c.column_name === error.column_name)
        if (col) {
          useEditorStore.getState().setActiveCategory(cat.category_code)
          if (targetLayer) {
            setActiveLayerId(makeLayerKey(targetLayer.layer_id, targetLayer.step_seq))
          }
          requestAnimationFrame(() => setActiveColumnName(error.column_name))
          break
        }
      }
    },
    [categories, project?.layers, setActiveLayerId, setActiveColumnName]
  )

  const handleNavigateToCell = useCallback(
    (layerName: string, columnName: string) => {
      const layer = project?.layers.find((l: ProjectLayerData) => l.layer_name === layerName)
      if (layer) {
        setActiveColumnName(null)
        for (const cat of categories) {
          const col = cat.columns.find((c: ColumnDefinition) => c.column_name === columnName)
          if (col) {
            useEditorStore.getState().setActiveCategory(cat.category_code)
            break
          }
        }
        setActiveLayerId(makeLayerKey(layer.layer_id, layer.step_seq))
        requestAnimationFrame(() => setActiveColumnName(columnName))
      }
    },
    [project, categories, setActiveLayerId, setActiveColumnName]
  )

  return {
    handleLayerClick,
    handleErrorClick,
    handleNavigateToCell,
  }
}
