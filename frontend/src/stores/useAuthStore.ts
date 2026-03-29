import { create } from 'zustand'
import client from '@/api/client'
import type { AuthUser } from '@/types/user'

export type { AuthUser }

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username?: string, password?: string) => Promise<void>
  logout: () => Promise<void>
  refreshToken: () => Promise<string | null>
  fetchCurrentUser: () => Promise<void>
  restoreSession: () => Promise<void>
  setAccessToken: (token: string) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: false,

  login: async (_username?: string, _password?: string) => {
    if (typeof window !== 'undefined') {
      window.location.href = '/api/auth/login'
    }
  },

  logout: async () => {
    try {
      await client.post('/auth/logout')
    } catch {
      // Always clear auth state, even if the request fails
    } finally {
      set({
        user: null,
        accessToken: null,
        isAuthenticated: false,
      })
    }
  },

  // Cookie-only 세션 구조에서는 refresh API를 사용하지 않음.
  refreshToken: async () => null,

  fetchCurrentUser: async () => {
    try {
      const response = await client.get<AuthUser>('/auth/me')
      const user = response.data
      set({
        user,
        accessToken: null,
        isAuthenticated: true,
      })
    } catch {
      set({
        user: null,
        accessToken: null,
        isAuthenticated: false,
      })
    }
  },

  // Cookie-only 세션 구조에서는 클라이언트 메모리 토큰을 사용하지 않음.
  setAccessToken: (_token: string) => {
    set({ accessToken: null })
  },

  restoreSession: async () => {
    set({ isLoading: true })
    try {
      await useAuthStore.getState().fetchCurrentUser()
    } finally {
      set({ isLoading: false })
    }
  },

  clearAuth: () => {
    set({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    })
  },
}))
