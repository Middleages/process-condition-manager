import { useCallback, useEffect, useState, useMemo } from 'react'
import { useParams, useBlocker } from 'react-router-dom'
import { useProjectDetail, useBulkSave, useValidateProjectMutation, useDeleteLayer } from '@/hooks/useProjects'
import { useColumns } from '@/hooks/useColumns'
import { useAllLayers } from '@/hooks/useProducts'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useUsers } from '@/hooks/useUsers'
import { useComments } from '@/hooks/useComments'
import { useEditorStore } from '@/stores/useEditorStore'
import { useUserStore } from '@/stores/useUserStore'
import { useToastStore } from '@/stores/useToastStore'
import { EditorHeader } from '@/components/editor/EditorHeader'
import { StatusBanner } from '@/components/editor/StatusBanner'
import { CategoryTabs } from '@/components/editor/CategoryTabs'
import { LayerNavPanel } from '@/components/editor/LayerNavPanel'
import { ConditionGrid } from '@/components/editor/ConditionGrid'
import { ValidationPanel } from '@/components/editor/ValidationPanel'
import { ChangeHistoryPanel } from '@/components/editor/ChangeHistoryPanel'
import { CommentPanel } from '@/components/editor/CommentPanel'
import { BackboneReplaceModal } from '@/components/editor/BackboneReplaceModal'
import { LayerAddModal } from '@/components/editor/LayerAddModal'
import { RecipeUploadModal } from '@/components/editor/RecipeUploadModal'
import { RevisionCreateModal } from '@/components/editor/RevisionCreateModal'
import { ReviewRequestModal } from '@/components/editor/ReviewRequestModal'
import { CommentDialog } from '@/components/editor/CommentDialog'
import { CellHistoryModal } from '@/components/editor/CellHistoryModal'
import { validateCellValue, buildConditionDependencyMap } from '@/lib/validation'
import { ApiError } from '@/api/client'
import type { LayerConditions, ValidationError, ProjectLayerData } from '@/types'
import { Loader2 } from 'lucide-react'

export default function ConditionEditorPage() {
  const { projectId } = useParams()
  const pid = Number(projectId)
  const currentUserId = useUserStore((s) => s.currentUserId)
  const addToast = useToastStore((s) => s.addToast)

  const { data: project, isLoading: projectLoading } = useProjectDetail(pid)
  const { data: categories = [], isLoading: columnsLoading } = useColumns()
  const { data: allLayers = [] } = useAllLayers()
  const { data: users = [] } = useUsers()
  const { data: commentData } = useComments(pid)

  const activeCategory = useEditorStore((s) => s.activeCategory)
  const activeLayerId = useEditorStore((s) => s.activeLayerId)
  const dirtyCells = useEditorStore((s) => s.dirtyCells)
  const validationErrors = useEditorStore((s) => s.validationErrors)
  const setValidationErrors = useEditorStore((s) => s.setValidationErrors)
  const setCellValue = useEditorStore((s) => s.setCellValue)
  const clearAllDirty = useEditorStore((s) => s.clearAllDirty)
  const setIsSaving = useEditorStore((s) => s.setIsSaving)
  const setActiveLayerId = useEditorStore((s) => s.setActiveLayerId)
  const isHistoryPanelOpen = useEditorStore((s) => s.isHistoryPanelOpen)
  const toggleHistoryPanel = useEditorStore((s) => s.toggleHistoryPanel)
  const cellHistoryTarget = useEditorStore((s) => s.cellHistoryTarget)
  const openCellHistory = useEditorStore((s) => s.openCellHistory)
  const closeCellHistory = useEditorStore((s) => s.closeCellHistory)

  const bulkSave = useBulkSave(pid)
  const validateMutation = useValidateProjectMutation()
  const deleteLayer = useDeleteLayer(pid)

  const hasDirty = dirtyCells.size > 0
  const isDraft = project?.status === 'draft'
  const isArchived = project?.status === 'archived'
  const isReadOnly = project?.status === 'review' || project?.status === 'approved' || project?.status === 'archived'

  // Get current user object
  const currentUser = users.find((u) => u.id === currentUserId) ?? null

  // Modal states
  const [backboneReplaceLayer, setBackboneReplaceLayer] = useState<ProjectLayerData | null>(null)
  const [showBackboneModal, setShowBackboneModal] = useState(false)
  const [showLayerAddModal, setShowLayerAddModal] = useState(false)
  const [showRecipeModal, setShowRecipeModal] = useState(false)
  const [showRevisionModal, setShowRevisionModal] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [showCommentPanel, setShowCommentPanel] = useState(true)

  // Comment dialog state
  const [commentDialogOpen, setCommentDialogOpen] = useState(false)
  const [commentTarget, setCommentTarget] = useState<{
    projectLayerId: number
    layerName: string
    columnName: string
    columnDisplayName: string
  } | null>(null)

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
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasDirty && currentLocation.pathname !== nextLocation.pathname
  )

  useEffect(() => {
    if (blocker.state === 'blocked') {
      const confirmed = window.confirm(
        '저장하지 않은 변경사항이 있습니다. 페이지를 떠나시겠습니까?'
      )
      if (confirmed) {
        blocker.proceed()
      } else {
        blocker.reset()
      }
    }
  }, [blocker])

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

  // Build dependency map for cross-field validation (memoized)
  const conditionDependencyMap = useMemo(
    () => buildConditionDependencyMap(categories),
    [categories]
  )

  // Build commentMap and rejectionCommentMap from comment data
  const commentMap = useMemo(() => {
    const map = new Map<string, number>()
    if (!commentData?.comments) return map
    for (const c of commentData.comments) {
      if (c.project_layer_id && c.column_name && !c.is_resolved) {
        const key = `${c.project_layer_id}:${c.column_name}`
        map.set(key, (map.get(key) ?? 0) + 1)
      }
    }
    return map
  }, [commentData])

  const rejectionCommentMap = useMemo(() => {
    const map = new Map<string, boolean>()
    if (!commentData?.comments) return map
    for (const c of commentData.comments) {
      if (c.project_layer_id && c.column_name && !c.is_resolved && c.comment_type === 'rejection') {
        const key = `${c.project_layer_id}:${c.column_name}`
        map.set(key, true)
      }
    }
    return map
  }, [commentData])

  // Run client-side validation on cell change
  const handleCellChanged = useCallback(
    (projectLayerId: number, columnName: string, newValue: unknown, _oldValue: unknown) => {
      // Prevent editing archived projects
      if (isArchived) {
        addToast('보관된 프로젝트는 수정할 수 없습니다.', 'error')
        return
      }

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

          let allNewErrors = [...otherErrors, ...newErrors]

          // Check if this column is a condition column for other fields
          const dependentColumns = conditionDependencyMap.get(columnName)
          if (dependentColumns && dependentColumns.length > 0) {
            // Re-validate dependent columns
            for (const depColumn of dependentColumns) {
              const depValue = layer.conditions[depColumn.column_name]
              const depErrors = validateCellValue(depValue, depColumn, layer.conditions)

              // Remove old errors for this dependent column
              allNewErrors = allNewErrors.filter(
                (e) => !(e.layer_id === layer.layer_id && e.column_name === depColumn.column_name)
              )

              // Add new errors for this dependent column
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

  // Build save payload from dirty cells
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

  // Handle save + server validation
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
      if (err instanceof ApiError && err.status === 409) {
        addToast('다른 사용자가 수정한 내용이 있습니다. 페이지를 새로고침 해주세요.', 'error')
      }
      // Other errors are handled by the Axios interceptor
    } finally {
      setIsSaving(false)
    }
  }, [project, currentUserId, buildSavePayload, bulkSave, clearAllDirty, setIsSaving, addToast, validateMutation, pid, setValidationErrors])

  // Auto-save every 30 seconds (only for draft/rejected, not read-only states)
  const { lastSavedAt } = useAutoSave({
    onSave: handleSave,
    enabled: !!project && !!currentUserId && !isReadOnly,
  })

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

  // Backbone replace handler
  const handleBackboneReplace = useCallback((layer: ProjectLayerData) => {
    setBackboneReplaceLayer(layer)
    setShowBackboneModal(true)
  }, [])

  // Layer delete handler
  const handleLayerDelete = useCallback(
    async (layer: ProjectLayerData) => {
      const confirmed = window.confirm(
        `"${layer.layer_name}" 레이어를 삭제하시겠습니까?\n이 레이어의 모든 조건 데이터가 삭제됩니다.`
      )
      if (!confirmed) return

      try {
        await deleteLayer.mutateAsync(layer.id)
        addToast(`"${layer.layer_name}" 레이어가 삭제되었습니다.`, 'success')
      } catch {
        // Error handled by interceptor
      }
    },
    [deleteLayer, addToast]
  )

  // Handle cell right-click
  const handleCellRightClick = useCallback(
    (projectLayerId: number, layerName: string, columnName: string, columnDisplayName: string) => {
      setCommentTarget({ projectLayerId, layerName, columnName, columnDisplayName })
      setCommentDialogOpen(true)
    },
    []
  )

  // Handle "View History" from context menu
  const handleViewHistory = useCallback(
    (projectLayerId: number, layerName: string, columnName: string) => {
      openCellHistory(projectLayerId, columnName, layerName)
    },
    [openCellHistory]
  )

  // Handle cell navigation from change history panel
  const handleNavigateToCell = useCallback(
    (layerName: string, columnName: string) => {
      const layer = project?.layers.find((l) => l.layer_name === layerName)
      if (layer) {
        for (const cat of categories) {
          const col = cat.columns.find((c) => c.column_name === columnName)
          if (col) {
            useEditorStore.getState().setActiveCategory(cat.category_code)
            break
          }
        }
        setActiveLayerId(layer.layer_id)
      }
    },
    [project, categories, setActiveLayerId]
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
        lastSavedAt={lastSavedAt}
        onRecipeUpload={!isReadOnly ? () => setShowRecipeModal(true) : undefined}
        onCreateRevision={() => setShowRevisionModal(true)}
        onReviewRequest={() => setShowReviewModal(true)}
        currentUser={currentUser}
        projectId={pid}
        onShowComments={() => setShowCommentPanel((prev) => !prev)}
        commentCount={commentData?.unresolved_count ?? 0}
        onToggleHistory={toggleHistoryPanel}
        isHistoryOpen={isHistoryPanelOpen}
      />

      <StatusBanner status={project.status} revision={project.revision} />

      <CategoryTabs categories={categories} />

      <div className="flex-1 flex overflow-hidden">
        <LayerNavPanel
          layers={project.layers}
          validationErrors={validationErrors}
          isDraft={isDraft}
          onLayerClick={handleLayerClick}
          onBackboneReplace={handleBackboneReplace}
          onLayerAdd={() => setShowLayerAddModal(true)}
          onLayerDelete={handleLayerDelete}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <ConditionGrid
            layers={project.layers}
            columns={activeColumns}
            validationErrors={validationErrors}
            scrollToLayerId={activeLayerId}
            readOnly={isReadOnly}
            commentMap={commentMap}
            rejectionCommentMap={rejectionCommentMap}
            projectStatus={project.status}
            currentUserRole={currentUser?.role}
            onCellChanged={handleCellChanged}
            onCellRightClick={handleCellRightClick}
            onViewHistory={handleViewHistory}
          />

          {validationErrors.length > 0 && (
            <ValidationPanel
              errors={validationErrors}
              onErrorClick={handleErrorClick}
            />
          )}

          <CommentPanel
            projectId={pid}
            categories={categories}
            layers={project.layers}
            isOpen={showCommentPanel}
            onToggle={setShowCommentPanel}
          />
        </div>

        <ChangeHistoryPanel
          projectId={pid}
          layers={project.layers}
          isOpen={isHistoryPanelOpen}
          onClose={toggleHistoryPanel}
          onNavigateToCell={handleNavigateToCell}
        />
      </div>

      {/* Backbone Replace Modal */}
      <BackboneReplaceModal
        open={showBackboneModal}
        onOpenChange={setShowBackboneModal}
        projectId={pid}
        layer={backboneReplaceLayer}
      />

      {/* Layer Add Modal */}
      <LayerAddModal
        open={showLayerAddModal}
        onOpenChange={setShowLayerAddModal}
        projectId={pid}
        existingLayers={project.layers}
        allLayers={allLayers}
      />

      {/* Recipe Upload Modal */}
      <RecipeUploadModal
        open={showRecipeModal}
        onOpenChange={setShowRecipeModal}
        projectId={pid}
        layers={project.layers}
      />

      {/* Revision Create Modal */}
      <RevisionCreateModal
        open={showRevisionModal}
        onOpenChange={setShowRevisionModal}
        project={project}
      />

      {/* Review Request Modal */}
      <ReviewRequestModal
        open={showReviewModal}
        onOpenChange={setShowReviewModal}
        projectId={pid}
        validationErrorCount={validationErrors.length}
      />

      {/* Comment Dialog */}
      <CommentDialog
        open={commentDialogOpen}
        onOpenChange={setCommentDialogOpen}
        projectId={pid}
        projectLayerId={commentTarget?.projectLayerId ?? null}
        layerName={commentTarget?.layerName ?? ''}
        columnName={commentTarget?.columnName ?? null}
        columnDisplayName={commentTarget?.columnDisplayName ?? null}
        currentUserId={currentUserId ?? 0}
        currentUserRole={currentUser?.role ?? 'editor'}
      />

      {/* Cell History Modal */}
      {cellHistoryTarget && (
        <CellHistoryModal
          projectId={pid}
          projectLayerId={cellHistoryTarget.projectLayerId}
          columnName={cellHistoryTarget.columnName}
          layerName={cellHistoryTarget.layerName}
          onClose={closeCellHistory}
        />
      )}
    </div>
  )
}
