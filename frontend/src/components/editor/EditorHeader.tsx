import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/projects/StatusBadge'
import { computeProjectDiff } from '@/lib/diff'
import { useEditorStore } from '@/stores/useEditorStore'
import { ApprovalButtons } from './ApprovalButtons'
import type { ProjectDetail, User } from '@/types'
import { ArrowLeft, Save, Loader2, AlertTriangle, GitCompare, FileUp, GitBranch, MessageSquare, Send } from 'lucide-react'

interface Props {
  project: ProjectDetail
  errorCount: number
  onSave: () => void
  lastSavedAt?: string | null
  onRecipeUpload?: () => void
  onCreateRevision?: () => void
  onReviewRequest?: () => void
  currentUser: User | null
  projectId: number
  onShowComments?: () => void
  commentCount?: number
}

export function EditorHeader({
  project,
  errorCount,
  onSave,
  lastSavedAt,
  onRecipeUpload,
  onCreateRevision,
  onReviewRequest,
  currentUser,
  projectId,
  onShowComments,
  commentCount = 0,
}: Props) {
  const navigate = useNavigate()
  const hasDirty = useEditorStore((s) => s.hasDirtyCells())
  const isSaving = useEditorStore((s) => s.isSaving)
  const dirtyCount = useEditorStore((s) => s.dirtyCells.size)

  const diffSummary = useMemo(
    () => computeProjectDiff(project.layers),
    [project.layers]
  )

  return (
    <div className="h-12 border-b bg-background flex items-center px-4 gap-4 shrink-0">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate('/projects')}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold">{project.product_name}</h1>
        <StatusBadge status={project.status} />
        <span className="text-xs text-muted-foreground">
          Backbone: {project.backbone_name}
        </span>
      </div>

      <div className="flex-1" />

      {diffSummary.totalChangedCells > 0 && (
        <div className="flex items-center gap-1.5 text-blue-500 text-xs">
          <GitCompare className="h-3.5 w-3.5" />
          <span>
            {diffSummary.totalChangedLayers}개 레이어 / {diffSummary.totalChangedCells}셀 변경
          </span>
        </div>
      )}

      {errorCount > 0 && (
        <div className="flex items-center gap-1.5 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4" />
          <span>오류 {errorCount}건</span>
        </div>
      )}

      {hasDirty && (
        <span className="text-xs text-muted-foreground">
          미저장 {dirtyCount}건
        </span>
      )}

      {lastSavedAt && !hasDirty && (
        <span className="text-xs text-muted-foreground">
          자동 저장됨 {lastSavedAt}
        </span>
      )}

      {/* Comments button */}
      {onShowComments && (
        <Button
          variant="outline"
          size="sm"
          onClick={onShowComments}
        >
          <MessageSquare className="mr-1.5 h-4 w-4" />
          댓글
          {commentCount > 0 && (
            <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
              {commentCount}
            </span>
          )}
        </Button>
      )}

      {/* Recipe Upload (draft only) */}
      {project.status === 'draft' && onRecipeUpload && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRecipeUpload}
        >
          <FileUp className="mr-1.5 h-4 w-4" />
          Recipe 업로드
        </Button>
      )}

      {/* Revision Create (approved only) */}
      {project.status === 'approved' && onCreateRevision && (
        <Button
          variant="outline"
          size="sm"
          onClick={onCreateRevision}
        >
          <GitBranch className="mr-1.5 h-4 w-4" />
          개정판 만들기
        </Button>
      )}

      {/* Approval buttons (review status, reviewer/admin only) */}
      <ApprovalButtons
        projectId={projectId}
        projectStatus={project.status}
        currentUser={currentUser}
      />

      {/* Review Request button (draft only) */}
      {project.status === 'draft' && onReviewRequest && (
        <Button
          variant="outline"
          size="sm"
          onClick={onReviewRequest}
        >
          <Send className="mr-1.5 h-4 w-4" />
          검토 요청
        </Button>
      )}

      {/* Save button (draft/rejected only) */}
      {project.status !== 'review' && project.status !== 'approved' && project.status !== 'archived' && (
        <Button
          size="sm"
          onClick={onSave}
          disabled={!hasDirty || isSaving}
        >
          {isSaving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" />
          )}
          저장
        </Button>
      )}
    </div>
  )
}
