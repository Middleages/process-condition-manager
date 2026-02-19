import type { ReactNode } from 'react'
import { useAuthStore } from '@/stores/useAuthStore'

interface RequireRoleProps {
  allowedRoles: string[]
  children?: ReactNode
  fallback?: ReactNode
}

/**
 * Conditionally renders children based on the current user's role.
 * This is a UI-level guard only — backend enforces the real RBAC.
 */
export default function RequireRole({ allowedRoles, children, fallback = null }: RequireRoleProps) {
  const user = useAuthStore((s) => s.user)

  if (!user || !allowedRoles.includes(user.role)) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
