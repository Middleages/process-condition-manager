import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useCreateComment } from '@/hooks/useComments'
import { useToastStore } from '@/stores/useToastStore'
import { hasAnyRole } from '@/lib/permissions'
import type { UserRole } from '@/types/user'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  projectLayerId: number | null
  layerName: string
  columnName: string | null
  columnDisplayName: string | null
  currentUserId: number
  // 다중 역할 배열로 전환
  currentUserRoles: string[]
}

export function CommentDialog({
  open,
  onOpenChange,
  projectId,
  projectLayerId,
  layerName,
  columnName,
  columnDisplayName,
  currentUserId,
  currentUserRoles,
}: Props) {
  // reviewer 또는 admin 역할 보유 여부
  const isReviewerOrAdmin = hasAnyRole(currentUserRoles as UserRole[], ['reviewer', 'admin'])
  // editor 전용 여부 (reviewer/admin 아님)
  const isEditorOnly = !isReviewerOrAdmin

  const [content, setContent] = useState('')
  const [commentType, setCommentType] = useState<'rejection' | 'general'>(
    isReviewerOrAdmin ? 'rejection' : 'general'
  )

  const createComment = useCreateComment(projectId)
  const addToast = useToastStore((s) => s.addToast)

  const handleSubmit = async () => {
    if (!content.trim()) {
      addToast('댓글 내용을 입력해주세요.', 'error')
      return
    }

    if (content.length > 2000) {
      addToast('댓글은 최대 2000자까지 입력할 수 있습니다.', 'error')
      return
    }

    try {
      await createComment.mutateAsync({
        user_id: currentUserId,
        project_layer_id: projectLayerId,
        column_name: columnName,
        content: content.trim(),
        comment_type: commentType,
      })

      addToast('댓글이 추가되었습니다.', 'success')
      setContent('')
      onOpenChange(false)
    } catch {
      // Error handled by interceptor
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>셀 댓글 작성</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 대상 셀 정보 */}
          <div className="text-sm text-muted-foreground">
            <div className="font-medium">위치:</div>
            <div className="ml-2">
              {layerName} &gt; {columnDisplayName || columnName || '(전체)'}
            </div>
          </div>

          {/* 댓글 유형 선택 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">댓글 유형</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="commentType"
                  value="rejection"
                  checked={commentType === 'rejection'}
                  onChange={(e) => setCommentType(e.target.value as 'rejection' | 'general')}
                  disabled={isEditorOnly}
                />
                <span className="text-sm">
                  반려 사유 {isEditorOnly && '(검토자만 가능)'}
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="commentType"
                  value="general"
                  checked={commentType === 'general'}
                  onChange={(e) => setCommentType(e.target.value as 'rejection' | 'general')}
                />
                <span className="text-sm">일반 댓글</span>
              </label>
            </div>
          </div>

          {/* 댓글 내용 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">내용</label>
            <textarea
              className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              placeholder="댓글 내용을 입력하세요 (최대 2000자)"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={2000}
            />
            <div className="text-xs text-muted-foreground text-right">
              {content.length} / 2000
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={createComment.isPending || !content.trim()}
          >
            {createComment.isPending ? '등록 중...' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
