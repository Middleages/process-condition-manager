import { useCallback, useEffect } from 'react'
import { useParams, useBlocker } from 'react-router-dom'
import { useProjectDetail, useBulkSave, useValidateProjectMutation } from '@/hooks/useProjects'
import { useColumns } from '@/hooks/useColumns'
import { useEditorStore } from '@/stores/useEditorStore'
import { useUserStore } from '@/stores/useUserStore'
import { useToastStore } from '@/stores/useToastStore'
import { EditorHeader } from '@/components/editor/EditorHeader'
import { CategoryTabs } from '@/components/editor/CategoryTabs'
import { LayerNavPanel } from '@/components/editor/LayerNavPanel'
import { ConditionGrid } from '@/components/editor/ConditionGrid'
import { ValidationPanel } from '@/components/editor/ValidationPanel'
import { validateCellValue } from '@/lib/validation'
import type { LayerConditions, ValidationError } from '@/types'
import { Loader2 } from 'lucide-react'

export default function ConditionEditorPage() {
  const { projectId } = useParams()
  const pid = Number(projectId)
  const currentUserId = useUserStore((s) => s.currentUserId)
  const addToast = useToastStore((s) => s.addToast)

  const { data: project, isLoading: projectLoading } = useProjectDetail(pid)
  const { data: categories = [], isLoading: columnsLoading } = useColumns()

  const activeCategory = useEditorStore((s) => s.activeCategory)
  const activeLayerId = useEditorStore((s) => s.activeLayerId)
  const dirtyCells = useEditorStore((s) => s.dirtyCells)
  const validationErrors = useEditorStore((s) => s.validationErrors)
  const setValidationErrors = useEditorStore((s) => s.setValidationErrors)
  const setCellValue = useEditorStore((s) => s.setCellValue)
  const clearAllDirty = useEditorStore((s) => s.clearAllDirty)
  const setIsSaving = useEditorStore((s) => s.setIsSaving)
  const setActiveLayerId = useEditorStore((s) => s.setActiveLayerId)

  const bulkSave = useBulkSave(pid)
  const validateMutation = useValidateProjectMutation()

  const hasDirty = dirtyCells.size > 0

  // --- beforeunload: warn on browser close/refresh ---
  useEffect(() => {
    if (!hasDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasDirty])

  // --- React Router navigation blocker ---
  useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasDirty && currentLocation.pathname !== nextLocation.pathname
  )

  // Reset editor state on mount/unmount
  useEffect(() => {
    return () => {
      useEditorStore.getState().reset()
    }
  }, [pid])

  // Set first layer as active when project loads
  useEffect(() => {
    if (project?.layers.length) {
      setActiveLayerId(project.layers[0].layer_id)
    }
  }, [project, setActiveLayerId])

  // Get active category's columns
  const activeCategoryData = categories.find((c) => c.category_code === activeCategory)
  const activeColumns = activeCategoryData?.columns ?? []

  // Run client-side validation on cell change
  const handleCellChanged = useCallback(
    (projectLayerId: number, columnName: string, newValue: unknown, _oldValue: unknown) => {
      // Find the backbone value for this cell
      const layer = project?.layers.find((l) => l.id === projectLayerId)
      const backboneValue = layer?.backbone_conditions[columnName]
      setCellValue(projectLayerId, columnName, newValue, backboneValue)

      // Run validation on this cell
      if (layer && activeCategoryData) {
        const colDef = activeCategoryData.columns.find((c) => c.column_name === columnName)
        if (colDef) {
          const cellErrors = validateCellValue(newValue, colDef, layer.conditions)
          const errorsState = useEditorStore.getState().validationErrors

          // Remove old errors for this cell, add new ones
          const otherErrors = errorsState.filter(
            (e) => !(e.layer_id === layer.layer_id && e.column_name === columnName)
          )
          const newErrors: ValidationError[] = cellErrors.map((msg) => ({
            layer_id: layer.layer_id,
            layer_name: layer.layer_name,
            column_name: columnName,
            display_name: colDef.display_name,
            rule_type: 'client',
            message: msg,
          }))

          setValidationErrors([...otherErrors, ...newErrors])
        }
      }
    },
    [project, activeCategoryData, setCellValue, setValidationErrors]
  )

  // Handle save + server validation
  const handleSave = useCallback(async () => {
    if (!project || !currentUserId) return

    setIsSaving(true)
    try {
      // Group dirty cells by projectLayerId
      const layerMap = new Map<number, Record<string, unknown>>()
      for (const cell of dirtyCells.values()) {
        const layer = project.layers.find((l) => l.id === cell.projectLayerId)
        if (!layer) continue

        if (!layerMap.has(cell.projectLayerId)) {
          layerMap.set(cell.projectLayerId, { ...layer.conditions })
        }
        layerMap.get(cell.projectLayerId)![cell.columnName] = cell.value
      }

      const layers: LayerConditions[] = Array.from(layerMap.entries()).map(
        ([projectLayerId, conditions]) => ({
          project_layer_id: projectLayerId,
          conditions,
        })
      )

      if (layers.length === 0) return

      const result = await bulkSave.mutateAsync({
        layers,
        updated_by: currentUserId,
        expected_updated_at: project.updated_at,
      })

      clearAllDirty()
      addToast(
        `저장 완료 (${result.updated_layers}개 레이어, ${result.change_log_count}건 변경)`,
        'success'
      )

      // Run server-side validation after save
      try {
        const validation = await validateMutation.mutateAsync(pid)
        setValidationErrors(validation.errors)
        if (validation.error_count > 0) {
          addToast(`검증 오류 ${validation.error_count}건이 있습니다.`, 'error')
        }
      } catch {
        // Validation call failed, keep client-side errors
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '저장에 실패했습니다.'
      addToast(msg, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [project, currentUserId, dirtyCells, bulkSave, clearAllDirty, setIsSaving, addToast, validateMutation, pid, setValidationErrors])

  // Handle layer nav click - scroll grid
  const handleLayerClick = useCallback(
    (layerId: number) => {
      setActiveLayerId(layerId)
    },
    [setActiveLayerId]
  )

  // Handle validation error click - navigate to cell
  const handleErrorClick = useCallback(
    (error: ValidationError) => {
      for (const cat of categories) {
        const col = cat.columns.find((c) => c.column_name === error.column_name)
        if (col) {
          useEditorStore.getState().setActiveCategory(cat.category_code)
          setActiveLayerId(error.layer_id)
          break
        }
      }
    },
    [categories, setActiveLayerId]
  )

  if (projectLoading || columnsLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        프로젝트를 찾을 수 없습니다.
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <EditorHeader
        project={project}
        errorCount={validationErrors.length}
        onSave={handleSave}
      />

      <CategoryTabs categories={categories} />

      <div className="flex-1 flex overflow-hidden">
        <LayerNavPanel
          layers={project.layers}
          validationErrors={validationErrors}
          onLayerClick={handleLayerClick}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <ConditionGrid
            layers={project.layers}
            columns={activeColumns}
            validationErrors={validationErrors}
            scrollToLayerId={activeLayerId}
            onCellChanged={handleCellChanged}
          />

          {validationErrors.length > 0 && (
            <ValidationPanel
              errors={validationErrors}
              onErrorClick={handleErrorClick}
            />
          )}
        </div>
      </div>
    </div>
  )
}
