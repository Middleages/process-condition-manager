import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import {
  defaultAuthState,
  getCurrentUser,
  resolveAuthPermissions,
  type AuthPermissions,
  type MeOut,
} from '@/api/auth'

export interface AuthContextValue {
  user: MeOut | null
  ready: boolean
  permissions: AuthPermissions
  error: unknown
  refresh: () => Promise<void>
}

export interface AuthProviderProps {
  children: ReactNode
  /**
   * Tests can inject a deterministic bootstrap state. Production should keep this undefined.
   */
  initialState?: Partial<Pick<AuthContextValue, 'user' | 'ready' | 'permissions' | 'error'>>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children, initialState }: AuthProviderProps) {
  const [ready, setReady] = useState(initialState?.ready ?? false)
  const [user, setUser] = useState<MeOut | null>(initialState?.user ?? null)
  const [permissions, setPermissions] = useState<AuthPermissions>(
    initialState?.permissions ?? defaultAuthState.permissions,
  )
  const [error, setError] = useState<unknown>(initialState?.error ?? null)

  const refresh = async () => {
    setReady(false)
    setError(null)

    try {
      const nextUser = await getCurrentUser()
      setUser(nextUser)
      setPermissions(resolveAuthPermissions(nextUser))
    } catch (nextError) {
      setUser(null)
      setPermissions(defaultAuthState.permissions)
      setError(nextError)
    } finally {
      setReady(true)
    }
  }

  useEffect(() => {
    if (initialState !== undefined) return

    void refresh()
  }, [initialState])

  return (
    <AuthContext.Provider
      value={{
        user,
        ready,
        permissions,
        error,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('AuthContext must be used within an AuthProvider')
  }

  return context
}

/** Optional boundary for embedded read-only surfaces and isolated render tests. */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext)
}
