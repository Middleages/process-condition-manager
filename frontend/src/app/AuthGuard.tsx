import type { ReactNode } from 'react'

import { getApiErrorStatus } from '@/api/client'

import { AuthProvider, useAuth } from './AuthContext'
import type { AuthContextValue } from './AuthContext'

export interface AuthGuardProps {
  children: ReactNode
  initialState?: Partial<
    Pick<AuthContextValue, 'user' | 'ready' | 'permissions' | 'error'>
  >
}

function AuthGuardContent({ children }: { children: ReactNode }) {
  const { ready, user, error, refresh } = useAuth()

  if (!ready) {
    return <p className="text-sm text-muted">사용자 권한을 확인하고 있습니다.</p>
  }

  if (error !== null || user === null) {
    const status = getApiErrorStatus(error)
    const isAuthError = status === 401 || status === 403

    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3">
        <p className="text-sm text-red-700">
          {isAuthError ? '인증이 필요해 로그인 정보를 다시 확인해 주세요.' : '사용자 권한을 확인하지 못했습니다.'}
        </p>
        <button type="button" onClick={() => void refresh()} className="mt-2 text-sm underline">
          다시 시도
        </button>
      </div>
    )
  }

  return <>{children}</>
}

export function AuthGuard({ children, initialState }: AuthGuardProps) {
  return (
    <AuthProvider initialState={initialState}>
      <AuthGuardContent>{children}</AuthGuardContent>
    </AuthProvider>
  )
}
