import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useChangeSummary, useStatusTransition } from '@/hooks/useComments'
import { useUserStore } from '@/stores/useUserStore'
import { useToastStore } from '@/stores/useToastStore'
import { Loader2, CheckCircle2, AlertTriangle, FileText } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  validationErrorCount: number
}

export function ReviewRequestModal({ open, onOpenChange, projectId, validationErrorCount }: Props) {
  const currentUserId = useUserStore((s) => s.currentUserId)
  const addToast = useToastStore((s) => s.addToast)
  const { data: summary, isLoading: summaryLoading } = useChangeSummary(projectId)
  const statusTransition = useStatusTransition(projectId)

  const [memo, setMemo] = useState('')

  useEffect(() => {
    if (open) {
      setMemo('')
    }
  }, [open])

  const hasErrors = validationErrorCount > 0
  const canSubmit = !hasErrors && !!currentUserId && !statusTransition.isPending

  const handleSubmit = async () => {
    if (!currentUserId || hasErrors) return

    try {
      await statusTransition.mutateAsync({
        new_status: 'review',
        changed_by: currentUserId,
        comment: memo || undefined,
      })
      addToast('검토 요청이 제출되었습니다.', 'success')
      onOpenChange(false)
    } catch {
      // Error handled by interceptor
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            검토 요청
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Validation Result */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
            hasErrors ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
          }`}>
            {hasErrors ? (
              <>
                <AlertTriangle className="h-4 w-4" />
                <span>검증 오류 {validationErrorCount}건 — 오류를 수정해야 검토 요청할 수 있습니다.</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span>검증 통과 (오류 0건)</span>
              </>
            )}
          </div>

          {/* Change Summary */}
          <div>
            <h4 className="text-sm font-medium mb-2">변경 요약</h4>
            {summaryLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                변경사항 집계 중...
              </div>
            ) : summary ? (
              <div className="bg-muted/50 rounded-md px-3 py-2 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">변경 레이어</span>
                  <span>{summary.changed_layers_count} / {summary.total_layers_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">변경 셀</span>
                  <span>{summary.changed_cells_count}건</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Backbone 교체</span>
                  <span>{summary.backbone_replacements_count}개 레이어</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recipe 적용</span>
                  <span>{summary.recipe_applications_count}개 레이어</span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Memo */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">메모 (선택)</label>
            <textarea
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[80px] resize-none"
              placeholder="검토자에게 전달할 메모를 입력하세요..."
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>

          {!currentUserId && (
            <p className="text-sm text-destructive">
              헤더에서 사용자를 먼저 선택해주세요.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {statusTransition.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            검토 요청 제출
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
