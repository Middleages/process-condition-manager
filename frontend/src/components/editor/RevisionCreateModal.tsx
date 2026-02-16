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
import { Input } from '@/components/ui/input'

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
              설명 (선택사항)
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="개정 사유를 입력하세요"
              maxLength={500}
            />
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
