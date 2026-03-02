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
import { useLines } from '@/hooks/useLines'
import type { AdminUser } from '@/types/adminUser'

// 지원 역할 목록 및 한국어 레이블
const ROLE_OPTIONS = [
  { value: 'editor', label: '편집자 (editor)' },
  { value: 'reviewer', label: '검토자 (reviewer)' },
  { value: 'admin', label: '관리자 (admin)' },
  { value: 'developer', label: '개발자 (developer)' },
] as const

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
  const [selectedRoles, setSelectedRoles] = useState<string[]>(['editor'])
  const [password, setPassword] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [lineId, setLineId] = useState<number | null>(null)
  const [serverError, setServerError] = useState('')

  const createMutation = useCreateAdminUser()
  const updateMutation = useUpdateAdminUser()
  const { data: lines = [] } = useLines()

  useEffect(() => {
    if (user) {
      setUsername(user.username)
      setDisplayName(user.display_name)
      setEmail(user.email ?? '')
      setSelectedRoles([...user.roles])
      setIsActive(user.is_active)
      setLineId(user.line_id ?? null)
    } else {
      setUsername('')
      setDisplayName('')
      setEmail('')
      setSelectedRoles(['editor'])
      setPassword('')
      setIsActive(true)
      setLineId(null)
    }
    setServerError('')
  }, [user, isOpen])

  // 역할 체크박스 토글
  const toggleRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')

    // 최소 1개 역할 필수
    if (selectedRoles.length === 0) {
      setServerError('최소 1개의 역할을 선택해야 합니다.')
      return
    }

    try {
      if (isEdit && user) {
        await updateMutation.mutateAsync({
          id: user.id,
          payload: {
            display_name: displayName,
            email: email || null,
            roles: selectedRoles,
            is_active: isActive,
            line_id: lineId,
          },
        })
      } else {
        await createMutation.mutateAsync({
          username,
          display_name: displayName,
          email: email || null,
          roles: selectedRoles,
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
          {/* 소속 라인 선택 */}
          <div>
            <label className="block text-sm font-medium mb-1">소속 라인</label>
            <select
              value={lineId ?? ''}
              onChange={(e) => setLineId(e.target.value ? Number(e.target.value) : null)}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
            >
              <option value="">미지정</option>
              {lines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.line_name} ({line.line_code})
                </option>
              ))}
            </select>
          </div>
          {/* 역할 선택: 다중 체크박스 */}
          <div>
            <label className="block text-sm font-medium mb-2">역할 *</label>
            <div className="flex flex-wrap gap-4">
              {ROLE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedRoles.includes(opt.value)}
                    onChange={() => toggleRole(opt.value)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>
            {selectedRoles.length === 0 && (
              <p className="text-red-600 text-xs mt-1">최소 1개의 역할을 선택해야 합니다.</p>
            )}
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
            <Button type="submit" disabled={isPending || selectedRoles.length === 0}>
              {isPending ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
