import { useStatusTransition, useComments } from '@/hooks/useComments'
import { useAuthStore } from '@/stores/useAuthStore'
import { useToastStore } from '@/stores/useToastStore'
import { hasAnyRole } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { ProjectStatus, User } from '@/types'

interface Props {
  projectId: number
  projectStatus: ProjectStatus
  currentUser: User | null
}

export function ApprovalButtons({ projectId, projectStatus, currentUser }: Props) {
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const addToast = useToastStore((s) => s.addToast)
  const statusTransition = useStatusTransition(projectId)
  const { data: commentData } = useComments(projectId)

  // review 상태일 때 reviewer/admin 역할만 승인/반려 가능
  if (projectStatus !== 'review') return null
  if (!currentUser || !hasAnyRole(currentUser.roles, ['reviewer', 'admin'])) return null

  const handleApprove = async () => {
    if (!currentUserId) return
    try {
      await statusTransition.mutateAsync({
        new_status: 'approved',
      })
      addToast('공정 조건표가 승인되었습니다.', 'success')
    } catch {
      // handled by interceptor
    }
  }

  const handleReject = async () => {
    if (!currentUserId) return

    const unresolvedCount = commentData?.unresolved_count ?? 0
    if (unresolvedCount === 0) {
      addToast('반려하려면 먼저 댓글을 추가해주세요.', 'error')
      return
    }

    try {
      await statusTransition.mutateAsync({
        new_status: 'rejected',
      })
      addToast('공정 조건표가 반려되었습니다.', 'success')
    } catch {
      // handled by interceptor
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="border-green-500 text-green-600 hover:bg-green-50 hover:text-green-700"
        onClick={handleApprove}
        disabled={statusTransition.isPending}
      >
        {statusTransition.isPending ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="mr-1.5 h-4 w-4" />
        )}
        승인
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="border-red-500 text-red-600 hover:bg-red-50 hover:text-red-700"
        onClick={handleReject}
        disabled={statusTransition.isPending}
      >
        {statusTransition.isPending ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <XCircle className="mr-1.5 h-4 w-4" />
        )}
        반려
      </Button>
    </div>
  )
}
