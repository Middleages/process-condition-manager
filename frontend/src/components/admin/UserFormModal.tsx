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
import { useCreateAdminUser, useUpdateAdminUser } from '@/hooks/useAdminUsers'
import type { AdminUser } from '@/types/adminUser'

interface UserFormModalProps {
  isOpen: boolean
  onClose: () => void
  user?: AdminUser | null
}

export function UserFormModal({ isOpen, onClose, user }: UserFormModalProps) {
  const isEdit = !!user

  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [password, setPassword] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [serverError, setServerError] = useState('')

  const createMutation = useCreateAdminUser()
  const updateMutation = useUpdateAdminUser()

  useEffect(() => {
    if (user) {
      setUsername(user.username)
      setDisplayName(user.display_name)
      setEmail(user.email ?? '')
      setRole(user.role)
      setIsActive(user.is_active)
    } else {
      setUsername('')
      setDisplayName('')
      setEmail('')
      setRole('editor')
      setPassword('')
      setIsActive(true)
    }
    setServerError('')
  }, [user, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')

    try {
      if (isEdit && user) {
        await updateMutation.mutateAsync({
          id: user.id,
          payload: {
            display_name: displayName,
            email: email || null,
            role,
            is_active: isActive,
          },
        })
      } else {
        await createMutation.mutateAsync({
          username,
          display_name: displayName,
          email: email || null,
          role,
          password,
        })
      }
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } }
      if (axiosErr.response?.status === 409) {
        setServerError('이미 존재하는 사용자명 또는 이메일입니다.')
      } else {
        setServerError(axiosErr.response?.data?.detail ?? '저장 중 오류가 발생했습니다.')
      }
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isEdit ? '사용자 수정' : '사용자 추가'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">사용자명 *</label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={isEdit}
              placeholder="username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">표시 이름 *</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              placeholder="홍길동"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">이메일</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">역할 *</label>
            <select
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="editor">편집자 (editor)</option>
              <option value="reviewer">검토자 (reviewer)</option>
              <option value="admin">관리자 (admin)</option>
            </select>
          </div>
          {!isEdit && (
            <div>
              <label className="block text-sm font-medium mb-1">비밀번호 *</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="비밀번호"
              />
            </div>
          )}
          {isEdit && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="isActive" className="text-sm font-medium">활성 사용자</label>
            </div>
          )}
          {serverError && (
            <p className="text-red-600 text-sm">{serverError}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              취소
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
