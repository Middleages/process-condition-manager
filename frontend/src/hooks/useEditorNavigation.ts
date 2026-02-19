import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEditorStore } from '@/stores/useEditorStore'
import type { ColumnCategory, ColumnDefinition, ProjectLayerData, ValidationError, ProjectDetail, VersionHistoryResponse } from '@/types'

interface UseEditorNavigationProps {
  project: ProjectDetail | undefined
  categories: ColumnCategory[]
  versionData: VersionHistoryResponse | undefined
}

export function useEditorNavigation({ project, categories, versionData }: UseEditorNavigationProps) {
  const navigate = useNavigate()
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
          setTimeout(() => setActiveColumnName(error.column_name), 0)
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
        setTimeout(() => setActiveColumnName(columnName), 0)
      }
    },
    [project, categories, setActiveLayerId, setActiveColumnName]
  )

  const handleBackToCurrent = useCallback(() => {
    if (!versionData) return
    const latestVersion = versionData.versions.find((v) => v.is_latest)
    if (latestVersion) {
      navigate(`/projects/${latestVersion.project_id}/edit`)
    }
  }, [versionData, navigate])

  return {
    handleLayerClick,
    handleErrorClick,
    handleNavigateToCell,
    handleBackToCurrent,
  }
}
