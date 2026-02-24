import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useParams, useBlocker } from 'react-router-dom'
import { useProjectDetail, useDeleteLayer, useValidateProjectMutation } from '@/hooks/useProjects'
import { useColumns } from '@/hooks/useColumns'
import { useAllLayers } from '@/hooks/useProducts'
import { useUsers } from '@/hooks/useUsers'
import { useComments } from '@/hooks/useComments'
import { useEditorStore } from '@/stores/useEditorStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useToastStore } from '@/stores/useToastStore'
import { useEditorCellEdit } from '@/hooks/useEditorCellEdit'
import { useEditorNavigation } from '@/hooks/useEditorNavigation'
import { useEditorModals } from '@/hooks/useEditorModals'
import { useConfirm } from '@/hooks/useConfirm'
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
import { BackboneComparisonPanel } from '@/components/editor/BackboneComparisonPanel'
import { CommentDialog } from '@/components/editor/CommentDialog'
import { CellHistoryModal } from '@/components/editor/CellHistoryModal'
import type { ProjectLayerData } from '@/types'
import type { GridApi } from 'ag-grid-community'
import { Loader2 } from 'lucide-react'
import { ExportPanel } from '@/components/export/ExportPanel'

export default function ConditionEditorPage() {
  const { projectId } = useParams()
  const pid = Number(projectId)
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const addToast = useToastStore((s) => s.addToast)

  const gridApiRef = useRef<GridApi | null>(null)

  // --- Data fetching ---
  const { data: project, isLoading: projectLoading } = useProjectDetail(pid)
  const { data: categories = [], isLoading: columnsLoading } = useColumns()
  const { data: allLayers = [] } = useAllLayers()
  const { data: users = [] } = useUsers()
  const { data: commentData } = useComments(pid)

  // --- Store selectors ---
  const activeCategory = useEditorStore((s) => s.activeCategory)
  const activeLayerId = useEditorStore((s) => s.activeLayerId)
  const dirtyCells = useEditorStore((s) => s.dirtyCells)
  const validationErrors = useEditorStore((s) => s.validationErrors)
  const setActiveLayerId = useEditorStore((s) => s.setActiveLayerId)
  const activeColumnName = useEditorStore((s) => s.activeColumnName)
  const isHistoryPanelOpen = useEditorStore((s) => s.isHistoryPanelOpen)
  const toggleHistoryPanel = useEditorStore((s) => s.toggleHistoryPanel)
  const cellHistoryTarget = useEditorStore((s) => s.cellHistoryTarget)
  const isVersionHistoryOpen = useEditorStore((s) => s.isVersionHistoryOpen)
  const toggleVersionHistory = useEditorStore((s) => s.toggleVersionHistory)
  const isBackboneComparisonOpen = useEditorStore((s) => s.isBackboneComparisonOpen)
  const toggleBackboneComparison = useEditorStore((s) => s.toggleBackboneComparison)
  const openCellHistory = useEditorStore((s) => s.openCellHistory)
  const closeCellHistory = useEditorStore((s) => s.closeCellHistory)

  const deleteLayer = useDeleteLayer(pid)

  const { confirm: confirmLayerDelete, ConfirmDialogElement: LayerDeleteDialog } = useConfirm({
    title: '레이어 삭제',
    description: '선택한 레이어를 삭제하시겠습니까? 이 레이어의 모든 조건 데이터가 삭제됩니다.',
    confirmText: '삭제',
    variant: 'destructive',
  })

  const { confirm: confirmNavigation, ConfirmDialogElement: NavigationDialog } = useConfirm({
    title: '페이지 이동',
    description: '저장하지 않은 변경사항이 있습니다. 페이지를 떠나시겠습니까?',
    confirmText: '떠나기',
    variant: 'destructive',
  })

  // --- Derived state ---
  const hasDirty = dirtyCells.size > 0
  const isDraft = project?.status === 'draft'
  const isArchived = project?.status === 'archived'
  const isReadOnly = project?.status === 'review' || project?.status === 'approved' || project?.status === 'archived'
  const currentUser = users.find((u) => u.id === currentUserId) ?? null


  const activeCategoryData = categories.find((c) => c.category_code === activeCategory)
  const activeColumns = activeCategoryData?.columns ?? []

  // --- Custom hooks ---
  const { handleCellChanged, handleSave, lastSavedAt } = useEditorCellEdit({
    projectId: pid,
    project,
    categories,
    currentUserId,
    isReadOnly,
    isArchived,
  })

  const { handleLayerClick, handleErrorClick, handleNavigateToCell } = useEditorNavigation({
    project,
    categories,
  })

  const modals = useEditorModals()

  // --- Comment maps ---
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

  // --- Effects ---
  useEffect(() => {
    if (!hasDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasDirty])

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasDirty && currentLocation.pathname !== nextLocation.pathname
  )

  useEffect(() => {
    if (blocker.state === 'blocked') {
      confirmNavigation().then((confirmed) => {
        if (confirmed) blocker.proceed()
        else blocker.reset()
      })
    }
  }, [blocker, confirmNavigation])

  useEffect(() => {
    const timer = setTimeout(() => { gridApiRef.current?.sizeColumnsToFit() }, 300)
    return () => clearTimeout(timer)
  }, [isHistoryPanelOpen, isBackboneComparisonOpen])

  useEffect(() => {
    return () => { useEditorStore.getState().reset() }
  }, [pid])

  useEffect(() => {
    if (project?.layers?.length) {
      const currentExists = project.layers.some(l => l.layer_id === activeLayerId)
      if (!currentExists) {
        setActiveLayerId(project.layers[0].layer_id)
      }
    }
  }, [project, setActiveLayerId, activeLayerId])

  // Auto-validate on project load to restore validation errors
  const validateMutation = useValidateProjectMutation()
  const setValidationErrors = useEditorStore((s) => s.setValidationErrors)
  const validateRef = useRef(validateMutation.mutateAsync)
  validateRef.current = validateMutation.mutateAsync
  useEffect(() => {
    if (!pid || !project) return
    validateRef.current(pid).then((validation) => {
      setValidationErrors(validation.errors)
    }).catch(() => {})
  }, [pid, project, setValidationErrors])

  // --- Handlers (page-specific) ---
  const handleLayerDelete = useCallback(
    async (layer: ProjectLayerData) => {
      const confirmed = await confirmLayerDelete()
      if (!confirmed) return
      try {
        await deleteLayer.mutateAsync(layer.id)
        addToast(`"${layer.layer_name}" 레이어가 삭제되었습니다.`, 'success')
      } catch {
        // Error handled by interceptor
      }
    },
    [deleteLayer, addToast, confirmLayerDelete]
  )

  const handleViewHistory = useCallback(
    (projectLayerId: number, layerName: string, columnName: string) => {
      openCellHistory(projectLayerId, columnName, layerName)
    },
    [openCellHistory]
  )

  // --- Loading / Error states ---
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
        onRecipeUpload={!isReadOnly ? () => modals.setShowRecipeModal(true) : undefined}
        onCreateRevision={() => modals.setShowRevisionModal(true)}
        onReviewRequest={() => modals.setShowReviewModal(true)}
        currentUser={currentUser}
        projectId={pid}
        onShowComments={() => modals.setShowCommentPanel((prev) => !prev)}
        commentCount={commentData?.unresolved_count ?? 0}
        onToggleHistory={toggleHistoryPanel}
        isHistoryOpen={isHistoryPanelOpen}
        onToggleVersionHistory={toggleVersionHistory}
        isVersionHistoryOpen={isVersionHistoryOpen}
        onToggleBackboneComparison={toggleBackboneComparison}
        isBackboneComparisonOpen={isBackboneComparisonOpen}
      />

      <StatusBanner
        status={project.status}
        revision={project.revision}
        projectId={isArchived ? pid : undefined}
      />

      {project.status === 'approved' && (
        <ExportPanel projectId={pid} />
      )}

      <CategoryTabs categories={categories} />

      <div className="flex-1 flex overflow-hidden">
        <LayerNavPanel
          layers={project.layers}
          validationErrors={validationErrors}
          isDraft={isDraft}
          onLayerClick={handleLayerClick}
          onBackboneReplace={modals.handleBackboneReplace}
          onLayerAdd={() => modals.setShowLayerAddModal(true)}
          onLayerDelete={handleLayerDelete}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <ConditionGrid
            layers={project.layers}
            columns={activeColumns}
            validationErrors={validationErrors}
            scrollToLayerId={activeLayerId}
            scrollToColumnName={activeColumnName}
            readOnly={isReadOnly}
            commentMap={commentMap}
            rejectionCommentMap={rejectionCommentMap}
            projectStatus={project.status}
            currentUserRole={currentUser?.role}
            onGridReady={(api) => { gridApiRef.current = api }}
            onCellChanged={handleCellChanged}
            onCellRightClick={modals.handleCellRightClick}
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
            isOpen={modals.showCommentPanel}
            onToggle={modals.setShowCommentPanel}
          />
        </div>

        <ChangeHistoryPanel
          projectId={pid}
          layers={project.layers}
          isOpen={isHistoryPanelOpen}
          onClose={toggleHistoryPanel}
          onNavigateToCell={handleNavigateToCell}
        />

        <BackboneComparisonPanel
          layers={project.layers}
          categories={categories}
          isOpen={isBackboneComparisonOpen}
          onClose={toggleBackboneComparison}
          onNavigateToCell={handleNavigateToCell}
        />
      </div>

      <BackboneReplaceModal
        open={modals.showBackboneModal}
        onOpenChange={modals.setShowBackboneModal}
        projectId={pid}
        layer={modals.backboneReplaceLayer}
      />

      <LayerAddModal
        open={modals.showLayerAddModal}
        onOpenChange={modals.setShowLayerAddModal}
        projectId={pid}
        existingLayers={project.layers}
        allLayers={allLayers}
      />

      <RecipeUploadModal
        open={modals.showRecipeModal}
        onOpenChange={modals.setShowRecipeModal}
        projectId={pid}
        layers={project.layers}
      />

      <RevisionCreateModal
        open={modals.showRevisionModal}
        onOpenChange={modals.setShowRevisionModal}
        project={project}
      />

      <ReviewRequestModal
        open={modals.showReviewModal}
        onOpenChange={modals.setShowReviewModal}
        projectId={pid}
        validationErrorCount={validationErrors.length}
        layers={project.layers}
        categories={categories}
      />

      <CommentDialog
        open={modals.commentDialogOpen}
        onOpenChange={modals.setCommentDialogOpen}
        projectId={pid}
        projectLayerId={modals.commentTarget?.projectLayerId ?? null}
        layerName={modals.commentTarget?.layerName ?? ''}
        columnName={modals.commentTarget?.columnName ?? null}
        columnDisplayName={modals.commentTarget?.columnDisplayName ?? null}
        currentUserId={currentUserId ?? 0}
        currentUserRole={currentUser?.role ?? 'editor'}
      />

      {cellHistoryTarget && (
        <CellHistoryModal
          projectId={pid}
          projectLayerId={cellHistoryTarget.projectLayerId}
          columnName={cellHistoryTarget.columnName}
          layerName={cellHistoryTarget.layerName}
          onClose={closeCellHistory}
        />
      )}

      {LayerDeleteDialog}
      {NavigationDialog}
    </div>
  )
}
