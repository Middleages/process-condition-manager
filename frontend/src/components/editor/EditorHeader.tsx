import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/projects/StatusBadge'
import { computeProjectDiff } from '@/lib/diff'
import { useEditorStore } from '@/stores/useEditorStore'
import type { ProjectDetail } from '@/types'
import { ArrowLeft, Save, Loader2, AlertTriangle, GitCompare, FileUp } from 'lucide-react'

interface Props {
  project: ProjectDetail
  errorCount: number
  onSave: () => void
  lastSavedAt?: string | null
  onRecipeUpload?: () => void
}

export function EditorHeader({ project, errorCount, onSave, lastSavedAt, onRecipeUpload }: Props) {
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
    </div>
  )
}
