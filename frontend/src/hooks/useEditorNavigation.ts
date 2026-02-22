import { useCallback } from 'react'
import { useEditorStore } from '@/stores/useEditorStore'
import type { ColumnCategory, ColumnDefinition, ProjectLayerData, ValidationError, ProjectDetail } from '@/types'

interface UseEditorNavigationProps {
  project: ProjectDetail | undefined
  categories: ColumnCategory[]
}

export function useEditorNavigation({ project, categories }: UseEditorNavigationProps) {
  const setActiveLayerId = useEditorStore((s) => s.setActiveLayerId)
  const setActiveColumnName = useEditorStore((s) => s.setActiveColumnName)

  const handleLayerClick = useCallback(
    (layerId: number) => {
      setActiveLayerId(layerId)
      setActiveColumnName(null)
    },
    [setActiveLayerId, setActiveColumnName]
  )

  const handleErrorClick = useCallback(
    (error: ValidationError) => {
      setActiveColumnName(null)
      for (const cat of categories) {
        const col = cat.columns.find((c: ColumnDefinition) => c.column_name === error.column_name)
        if (col) {
          useEditorStore.getState().setActiveCategory(cat.category_code)
          setActiveLayerId(error.layer_id)
          requestAnimationFrame(() => setActiveColumnName(error.column_name))
          break
        }
      }
    },
    [categories, setActiveLayerId, setActiveColumnName]
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
        setActiveLayerId(layer.layer_id)
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
