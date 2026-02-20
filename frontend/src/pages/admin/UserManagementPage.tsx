import { useState } from 'react'
import { Plus, Pencil, KeyRound, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import UserFormModal from '@/components/admin/UserFormModal'
import PasswordResetModal from '@/components/admin/PasswordResetModal'
import { useAdminUsers, useDeactivateAdminUser } from '@/hooks/useAdminUsers'
import type { AdminUser } from '@/types/adminUser'

function roleBadge(role: string) {
  if (role === 'admin') return 'bg-red-100 text-red-800'
  if (role === 'reviewer') return 'bg-blue-100 text-blue-800'
  return 'bg-green-100 text-green-800'
}

function roleLabel(role: string) {
  if (role === 'admin') return '관리자'
  if (role === 'reviewer') return '검토자'
  return '편집자'
}

export default function UserManagementPage() {
  const [includeInactive, setIncludeInactive] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [isPasswordOpen, setIsPasswordOpen] = useState(false)
  const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null)

  const { data: users = [], isLoading } = useAdminUsers(includeInactive)
  const deactivateMutation = useDeactivateAdminUser()

  const handleAddUser = () => {
    setSelectedUser(null)
    setIsFormOpen(true)
  }

  const handleEditUser = (user: AdminUser) => {
    setSelectedUser(user)
    setIsFormOpen(true)
  }

  const handlePasswordReset = (user: AdminUser) => {
    setPasswordUser(user)
    setIsPasswordOpen(true)
  }

  const handleDeactivate = async (user: AdminUser) => {
    if (!confirm(`'${user.display_name}' 사용자를 비활성화하시겠습니까?`)) return
    try {
      await deactivateMutation.mutateAsync(user.id)
    } catch {
      alert('비활성화 중 오류가 발생했습니다.')
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">사용자 관리</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="h-4 w-4"
            />
            비활성 사용자 포함
          </label>
          <Button onClick={handleAddUser} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            사용자 추가
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">사용자명</th>
              <th className="px-4 py-3 text-left font-medium">표시 이름</th>
              <th className="px-4 py-3 text-left font-medium">이메일</th>
              <th className="px-4 py-3 text-left font-medium">역할</th>
              <th className="px-4 py-3 text-left font-medium">상태</th>
              <th className="px-4 py-3 text-left font-medium">생성일</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  로딩 중...
                </td>
              </tr>
            )}
            {!isLoading && users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  사용자가 없습니다.
                </td>
              </tr>
            )}
            {users.map((user) => (
              <tr
                key={user.id}
                className={`border-t hover:bg-muted/50 ${!user.is_active ? 'opacity-50' : ''}`}
              >
                <td className="px-4 py-3 font-mono text-xs">{user.username}</td>
                <td className="px-4 py-3">{user.display_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{user.email ?? '-'}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${roleBadge(user.role)}`}
                  >
                    {roleLabel(user.role)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {user.is_active ? (
                    <Badge variant="outline" className="text-green-700 border-green-300">활성</Badge>
                  ) : (
                    <Badge variant="outline" className="text-gray-500 border-gray-300">비활성</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(user.created_at).toLocaleDateString('ko-KR')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEditUser(user)}
                      title="수정"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePasswordReset(user)}
                      title="비밀번호 초기화"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                    </Button>
                    {user.is_active && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeactivate(user)}
                        title="비활성화"
                        className="text-red-600 hover:text-red-700"
                      >
                        <UserX className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UserFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        user={selectedUser}
      />
      <PasswordResetModal
        isOpen={isPasswordOpen}
        onClose={() => setIsPasswordOpen(false)}
        user={passwordUser}
      />
    </div>
  )
}
