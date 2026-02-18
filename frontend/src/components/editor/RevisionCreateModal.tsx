import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReviseProject } from '@/hooks/useProjects'
import { useToastStore } from '@/stores/useToastStore'
import type { ProjectDetail } from '@/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface RevisionCreateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: ProjectDetail | null
}

export function RevisionCreateModal({ open, onOpenChange, project }: RevisionCreateModalProps) {
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const reviseMutation = useReviseProject()

  const [description, setDescription] = useState('')

  useEffect(() => {
    if (!open) {
      setDescription('')
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!project) return

    try {
      const newProject = await reviseMutation.mutateAsync({
        projectId: project.id,
        request: description ? { description } : undefined,
      })

      addToast(`개정판 v${newProject.revision}이(가) 생성되었습니다.`, 'success')
      onOpenChange(false)
      navigate(`/projects/${newProject.id}/edit`)
    } catch {
      // Error handled by interceptor
    }
  }

  if (!project) return null

  const nextVersion = project.revision + 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>개정판 만들기</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-sm text-muted-foreground">
            현재 승인된 조건표를 기반으로 새 버전 <strong>v{nextVersion}</strong>을(를) 생성합니다.
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              개정 사유 (권장)
            </label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="변경할 내용과 사유를 기술해 주세요"
              maxLength={500}
            />
            {/* 글자 수 카운터 */}
            <div className="text-right text-xs text-muted-foreground mt-1">
              {description.length}/500
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={reviseMutation.isPending}
            >
              취소
            </Button>
            <Button type="submit" disabled={reviseMutation.isPending}>
              생성
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
