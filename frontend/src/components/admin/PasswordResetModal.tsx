import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useResetAdminPassword } from '@/hooks/useAdminUsers'
import type { AdminUser } from '@/types/adminUser'

interface PasswordResetModalProps {
  isOpen: boolean
  onClose: () => void
  user: AdminUser | null
}

export default function PasswordResetModal({ isOpen, onClose, user }: PasswordResetModalProps) {
  const [newPassword, setNewPassword] = useState('')
  const [serverError, setServerError] = useState('')

  const resetMutation = useResetAdminPassword()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')

    if (!user) return

    try {
      await resetMutation.mutateAsync({ id: user.id, payload: { new_password: newPassword } })
      setNewPassword('')
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setServerError(axiosErr.response?.data?.detail ?? '비밀번호 초기화 중 오류가 발생했습니다.')
    }
  }

  const handleClose = () => {
    setNewPassword('')
    setServerError('')
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent onClose={handleClose}>
        <DialogHeader>
          <DialogTitle>비밀번호 초기화 - {user?.display_name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">새 비밀번호 *</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              placeholder="새 비밀번호를 입력하세요"
            />
          </div>
          {serverError && (
            <p className="text-red-600 text-sm">{serverError}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={resetMutation.isPending}>
              취소
            </Button>
            <Button type="submit" disabled={resetMutation.isPending}>
              {resetMutation.isPending ? '처리 중...' : '초기화'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
