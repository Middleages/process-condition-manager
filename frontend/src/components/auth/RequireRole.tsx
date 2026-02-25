import type { ReactNode } from 'react'
import { useAuthStore } from '@/stores/useAuthStore'
import { hasAnyRole } from '@/lib/permissions'
import type { UserRole } from '@/types/user'

interface RequireRoleProps {
  allowedRoles: string[]
  children?: ReactNode
  fallback?: ReactNode
}

/**
 * 현재 사용자의 역할 배열 중 하나라도 allowedRoles에 포함되면 children을 렌더링.
 * UI 레벨 가드 전용 -- 실제 RBAC는 백엔드에서 적용.
 */
export default function RequireRole({ allowedRoles, children, fallback = null }: RequireRoleProps) {
  const user = useAuthStore((s) => s.user)

  if (!user || !hasAnyRole(user.roles, allowedRoles as UserRole[])) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
