import { useCallback, useMemo } from 'react'
import { useBulkSave, useValidateProjectMutation } from '@/hooks/useProjects'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useEditorStore } from '@/stores/useEditorStore'
import { useToastStore } from '@/stores/useToastStore'
import { validateCellValue, buildConditionDependencyMap } from '@/lib/validation'
import { ApiError } from '@/api/client'
import type { ColumnCategory, LayerConditions, ValidationError, ProjectDetail } from '@/types'

interface UseEditorCellEditProps {
  projectId: number
  project: ProjectDetail | undefined
  categories: ColumnCategory[]
  currentUserId: number | null
  isReadOnly: boolean | undefined
  isArchived: boolean | undefined
}

export function useEditorCellEdit({
  projectId,
  project,
  categories,
  currentUserId,
  isReadOnly,
  isArchived,
}: UseEditorCellEditProps) {
  const addToast = useToastStore((s) => s.addToast)
  const activeCategory = useEditorStore((s) => s.activeCategory)
  const dirtyCells = useEditorStore((s) => s.dirtyCells)
  const setCellValue = useEditorStore((s) => s.setCellValue)
  const setValidationErrors = useEditorStore((s) => s.setValidationErrors)
  const clearAllDirty = useEditorStore((s) => s.clearAllDirty)
  const setIsSaving = useEditorStore((s) => s.setIsSaving)

  const bulkSave = useBulkSave(projectId)
  const validateMutation = useValidateProjectMutation()

  const activeCategoryData = categories.find((c) => c.category_code === activeCategory)

  const conditionDependencyMap = useMemo(
    () => buildConditionDependencyMap(categories),
    [categories]
  )

  const handleCellChanged = useCallback(
    (projectLayerId: number, columnName: string, newValue: unknown, _oldValue: unknown) => {
      if (isArchived) {
        addToast('보관된 프로젝트는 수정할 수 없습니다.', 'error')
        return
      }

      const layer = project?.layers.find((l) => l.id === projectLayerId)
      const serverValue = layer?.conditions[columnName]
      setCellValue(projectLayerId, columnName, newValue, serverValue)

      if (layer && activeCategoryData) {
        const colDef = activeCategoryData.columns.find((c) => c.column_name === columnName)
        if (colDef) {
          const cellErrors = validateCellValue(newValue, colDef, layer.conditions)
          const errorsState = useEditorStore.getState().validationErrors

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

          let allNewErrors = [...otherErrors, ...newErrors]

          const dependentColumns = conditionDependencyMap.get(columnName)
          if (dependentColumns && dependentColumns.length > 0) {
            for (const depColumn of dependentColumns) {
              const depValue = layer.conditions[depColumn.column_name]
              const depErrors = validateCellValue(depValue, depColumn, layer.conditions)

              allNewErrors = allNewErrors.filter(
                (e) => !(e.layer_id === layer.layer_id && e.column_name === depColumn.column_name)
              )

              const depNewErrors: ValidationError[] = depErrors.map((msg) => ({
                layer_id: layer.layer_id,
                layer_name: layer.layer_name,
                column_name: depColumn.column_name,
                display_name: depColumn.display_name,
                rule_type: 'client',
                message: msg,
              }))
              allNewErrors = [...allNewErrors, ...depNewErrors]
            }
          }

          setValidationErrors(allNewErrors)
        }
      }
    },
    [project, activeCategoryData, conditionDependencyMap, setCellValue, setValidationErrors, isArchived, addToast]
  )

  const buildSavePayload = useCallback((): LayerConditions[] => {
    if (!project) return []
    const layerMap = new Map<number, Record<string, unknown>>()
    for (const cell of dirtyCells.values()) {
      const layer = project.layers.find((l) => l.id === cell.projectLayerId)
      if (!layer) continue
      if (!layerMap.has(cell.projectLayerId)) {
        layerMap.set(cell.projectLayerId, { ...layer.conditions })
      }
      layerMap.get(cell.projectLayerId)![cell.columnName] = cell.value
    }
    return Array.from(layerMap.entries()).map(([project_layer_id, conditions]) => ({
      project_layer_id,
      conditions,
    }))
  }, [project, dirtyCells])

  const handleSave = useCallback(async () => {
    if (!project) return
    if (!currentUserId) {
      addToast('헤더에서 사용자를 먼저 선택해주세요.', 'error')
      return
    }

    const layers = buildSavePayload()
    if (layers.length === 0) return

    setIsSaving(true)
    try {
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

      try {
        const validation = await validateMutation.mutateAsync(projectId)
        setValidationErrors(validation.errors)
        if (validation.error_count > 0) {
          addToast(`검증 오류 ${validation.error_count}건이 있습니다.`, 'error')
        }
      } catch {
        // Validation call failed, keep client-side errors
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        addToast('다른 사용자가 수정한 내용이 있습니다. 페이지를 새로고침 해주세요.', 'error')
      }
    } finally {
      setIsSaving(false)
    }
  }, [project, currentUserId, buildSavePayload, bulkSave, clearAllDirty, setIsSaving, addToast, validateMutation, projectId, setValidationErrors])

  const { lastSavedAt } = useAutoSave({
    onSave: handleSave,
    enabled: !!project && !!currentUserId && !isReadOnly,
  })

  return {
    handleCellChanged,
    handleSave,
    lastSavedAt,
  }
}
