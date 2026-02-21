import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useCreateLine, useUpdateLine } from '@/hooks/useAdminMaster'
import type { LineResponse } from '@/api/adminMaster'

interface LineFormModalProps {
  isOpen: boolean
  onClose: () => void
  line?: LineResponse | null
}

export function LineFormModal({ isOpen, onClose, line }: LineFormModalProps) {
  const isEdit = !!line
  const [lineCode, setLineCode] = useState('')
  const [lineName, setLineName] = useState('')
  const [serverError, setServerError] = useState('')

  const createMutation = useCreateLine()
  const updateMutation = useUpdateLine()

  useEffect(() => {
    if (line) {
      setLineCode(line.line_code)
      setLineName(line.line_name)
    } else {
      setLineCode('')
      setLineName('')
    }
    setServerError('')
  }, [line, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')
    try {
      if (isEdit && line) {
        await updateMutation.mutateAsync({ id: line.id, payload: { line_code: lineCode, line_name: lineName } })
      } else {
        await createMutation.mutateAsync({ line_code: lineCode, line_name: lineName })
      }
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setServerError(axiosErr.response?.data?.detail ?? '저장 중 오류가 발생했습니다.')
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isEdit ? '라인 수정' : '라인 추가'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">라인 코드 *</label>
            <Input
              value={lineCode}
              onChange={(e) => setLineCode(e.target.value)}
              required
              placeholder="예: L01"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">라인 이름 *</label>
            <Input
              value={lineName}
              onChange={(e) => setLineName(e.target.value)}
              required
              placeholder="예: Line 1"
            />
          </div>
          {serverError && <p className="text-red-600 text-sm">{serverError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>취소</Button>
            <Button type="submit" disabled={isPending}>{isPending ? '저장 중...' : '저장'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
