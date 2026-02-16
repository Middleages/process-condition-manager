import { useCallback, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RecipeDiffTable } from './RecipeDiffTable'
import { useUploadRecipe, useApplyRecipe } from '@/hooks/useProjects'
import { useUserStore } from '@/stores/useUserStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useToastStore } from '@/stores/useToastStore'
import type { ProjectLayerData, RecipeDiffResult, RecipeApplyItem } from '@/types'
import { AlertTriangle, FileUp, Loader2, Upload } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  layers: ProjectLayerData[]
}

type Step = 'upload' | 'diff'

export function RecipeUploadModal({ open, onOpenChange, projectId, layers }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [files, setFiles] = useState<File[]>([])
  const [selectedLayerId, setSelectedLayerId] = useState<number | undefined>(undefined)
  const [diffResults, setDiffResults] = useState<RecipeDiffResult[]>([])
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadMutation = useUploadRecipe(projectId)
  const applyMutation = useApplyRecipe(projectId)
  const currentUserId = useUserStore((s) => s.currentUserId)
  const addToast = useToastStore((s) => s.addToast)
  const addRecipeCells = useEditorStore((s) => s.addRecipeCells)

  const resetState = useCallback(() => {
    setStep('upload')
    setFiles([])
    setSelectedLayerId(undefined)
    setDiffResults([])
    setSelectedColumns(new Set())
  }, [])

  const handleClose = useCallback(() => {
    resetState()
    onOpenChange(false)
  }, [onOpenChange, resetState])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files
    if (selected) {
      setFiles(Array.from(selected))
    }
  }, [])

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return

    try {
      const result = await uploadMutation.mutateAsync({
        files,
        projectLayerId: selectedLayerId,
      })
      setDiffResults(result.results)
      // Auto-select all different items
      const allDiff = new Set<string>()
      for (const r of result.results) {
        for (const item of r.items) {
          if (item.is_different) allDiff.add(item.column_name)
        }
      }
      setSelectedColumns(allDiff)
      setStep('diff')
    } catch {
      // Error handled by interceptor
    }
  }, [files, selectedLayerId, uploadMutation])

  const handleApply = useCallback(async () => {
    if (!currentUserId) {
      addToast('사용자를 먼저 선택해주세요.', 'error')
      return
    }

    const changes: RecipeApplyItem[] = []
    for (const result of diffResults) {
      if (!result.project_layer_id) continue
      for (const item of result.items) {
        if (item.is_different && selectedColumns.has(item.column_name)) {
          changes.push({
            project_layer_id: result.project_layer_id,
            column_name: item.column_name,
            new_value: item.recipe_value,
          })
        }
      }
    }

    if (changes.length === 0) {
      addToast('적용할 항목을 선택해주세요.', 'error')
      return
    }

    try {
      const result = await applyMutation.mutateAsync({
        changes,
        applied_by: currentUserId,
      })

      // Track recipe-applied cells for green highlighting
      const recipeKeys = changes.map(
        (c) => `${c.project_layer_id}:${c.column_name}`
      )
      addRecipeCells(recipeKeys)

      addToast(
        `Recipe 적용 완료 (${result.applied_count}건 변경)`,
        'success'
      )
      handleClose()
    } catch {
      // Error handled by interceptor
    }
  }, [currentUserId, diffResults, selectedColumns, applyMutation, addRecipeCells, addToast, handleClose])

  // Get active diff result (first with project_layer_id, or first overall)
  const activeDiff = diffResults.length > 0 ? diffResults[0] : null

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl" onClose={handleClose}>
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' ? 'Recipe XML 업로드' : 'Recipe Diff 결과'}
          </DialogTitle>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            {/* File input */}
            <div>
              <label className="block text-sm font-medium mb-1">XML 파일 선택</label>
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                {files.length > 0 ? (
                  <div className="text-sm">
                    {files.map((f) => f.name).join(', ')}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    클릭하여 파일 선택 (.xml)
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xml"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            </div>

            {/* Optional layer targeting */}
            <div>
              <label className="block text-sm font-medium mb-1">대상 레이어 (선택사항)</label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={selectedLayerId ?? ''}
                onChange={(e) =>
                  setSelectedLayerId(e.target.value ? Number(e.target.value) : undefined)
                }
              >
                <option value="">자동 감지 (PID/파일명 기반)</option>
                {layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.layer_name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                레이어를 직접 지정하지 않으면 XML의 PID 또는 파일명으로 자동 매칭합니다.
              </p>
            </div>
          </div>
        )}

        {step === 'diff' && activeDiff && (
          <div className="space-y-3">
            {/* Layer info */}
            <div className="flex items-center gap-3 text-sm bg-muted/30 rounded-md px-3 py-2">
              <span className="font-medium">
                대상 레이어: {activeDiff.layer_name ?? '(미매칭)'}
              </span>
              {activeDiff.detected_layer_key && (
                <span className="text-muted-foreground">
                  감지 키: {activeDiff.detected_layer_key}
                </span>
              )}
            </div>

            {/* Warnings */}
            {activeDiff.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                {activeDiff.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-amber-800">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{w.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* No target layer warning */}
            {!activeDiff.project_layer_id && (
              <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <div className="flex items-start gap-2 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    대상 레이어를 자동 매칭하지 못했습니다.
                    뒤로 돌아가서 레이어를 직접 지정해주세요.
                  </span>
                </div>
              </div>
            )}

            {/* Diff table */}
            <div className="max-h-[400px] overflow-y-auto">
              <RecipeDiffTable
                items={activeDiff.items}
                selectedColumns={selectedColumns}
                onSelectionChange={setSelectedColumns}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'upload' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                취소
              </Button>
              <Button
                onClick={handleUpload}
                disabled={files.length === 0 || uploadMutation.isPending}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="mr-1.5 h-4 w-4" />
                )}
                업로드 및 비교
              </Button>
            </>
          )}
          {step === 'diff' && (
            <>
              <Button variant="outline" onClick={() => setStep('upload')}>
                뒤로
              </Button>
              <Button variant="outline" onClick={handleClose}>
                취소
              </Button>
              <Button
                onClick={handleApply}
                disabled={
                  selectedColumns.size === 0 ||
                  !activeDiff?.project_layer_id ||
                  applyMutation.isPending
                }
              >
                {applyMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                선택 항목 적용 ({selectedColumns.size}건)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
