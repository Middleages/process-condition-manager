import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useUpdateComment, useDeleteComment } from '@/hooks/useComments'
import { useAuthStore } from '@/stores/useAuthStore'
import { useToastStore } from '@/stores/useToastStore'
import type { Comment } from '@/types'
import { Check, Pencil, Trash2, MapPin, Loader2, X } from 'lucide-react'
import { useConfirm } from '@/hooks/useConfirm'
import { formatDate } from '@/lib/utils'

interface Props {
  comment: Comment
  projectId: number
  onNavigate?: (comment: Comment) => void
}

export function CommentThread({ comment, projectId, onNavigate }: Props) {
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const addToast = useToastStore((s) => s.addToast)
  const updateMutation = useUpdateComment(projectId)
  const deleteMutation = useDeleteComment(projectId)

  const { confirm: confirmDelete, ConfirmDialogElement: DeleteDialog } = useConfirm({
    title: '댓글 삭제',
    description: '댓글을 삭제하시겠습니까?',
    confirmText: '삭제',
    variant: 'destructive',
  })

  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(comment.content)

  const isOwner = currentUserId === comment.created_by
  const isAdmin = false // Will be checked via user data in future

  const positionLabel = comment.layer_name
    ? comment.column_name
      ? `${comment.layer_name} > ${comment.column_display_name ?? comment.column_name}`
      : comment.layer_name
    : '프로젝트 전체'

  const handleResolve = async () => {
    if (!currentUserId) return
    try {
      await updateMutation.mutateAsync({
        commentId: comment.id,
        req: { is_resolved: true, resolved_by: currentUserId },
      })
      addToast('댓글이 해결되었습니다.', 'success')
    } catch {
      // handled by interceptor
    }
  }

  const handleSaveEdit = async () => {
    if (!editContent.trim()) return
    try {
      await updateMutation.mutateAsync({
        commentId: comment.id,
        req: { content: editContent.trim() },
      })
      setIsEditing(false)
      addToast('댓글이 수정되었습니다.', 'success')
    } catch {
      // handled by interceptor
    }
  }

  const handleDelete = async () => {
    if (!(await confirmDelete())) return
    try {
      await deleteMutation.mutateAsync(comment.id)
      addToast('댓글이 삭제되었습니다.', 'success')
    } catch {
      // handled by interceptor
    }
  }

  return (
    <div className={`border rounded-md p-3 text-sm ${
      !comment.is_resolved && comment.comment_type === 'rejection'
        ? 'border-red-300 bg-red-50/50'
        : comment.is_resolved
          ? 'border-muted bg-muted/30 opacity-70'
          : 'border-border'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-medium truncate">{comment.creator_name}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
            {comment.creator_role}
          </Badge>
          {comment.comment_type === 'rejection' && (
            <Badge variant="destructive" className="text-[10px] px-1 py-0 shrink-0">
              반려
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatDate(comment.created_at)}
        </span>
      </div>

      {/* Position */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
        <MapPin className="h-3 w-3" />
        <button
          className="hover:underline hover:text-foreground"
          onClick={() => onNavigate?.(comment)}
        >
          {positionLabel}
        </button>
      </div>

      {/* Content */}
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm min-h-[60px] resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
          />
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>
              <X className="h-3 w-3 mr-1" />
              취소
            </Button>
            <Button
              size="sm"
              onClick={handleSaveEdit}
              disabled={!editContent.trim() || updateMutation.isPending}
            >
              {updateMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              저장
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap">{comment.content}</p>
      )}

      {/* Resolution status */}
      {comment.is_resolved && (
        <div className="text-xs text-green-600 mt-2 flex items-center gap-1">
          <Check className="h-3 w-3" />
          해결됨 {comment.resolver_name && `(${comment.resolver_name})`}
          {comment.resolved_at && ` · ${formatDate(comment.resolved_at)}`}
        </div>
      )}

      {/* Actions */}
      {!comment.is_resolved && !isEditing && (
        <div className="flex gap-1.5 mt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleResolve}
            disabled={updateMutation.isPending}
          >
            <Check className="h-3 w-3 mr-1" />
            해결
          </Button>
          {(isOwner || isAdmin) && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setEditContent(comment.content)
                  setIsEditing(true)
                }}
              >
                <Pencil className="h-3 w-3 mr-1" />
                수정
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                삭제
              </Button>
            </>
          )}
        </div>
      )}

      {DeleteDialog}
    </div>
  )
}
