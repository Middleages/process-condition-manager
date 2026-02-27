import { create } from 'zustand'
import client from '@/api/client'
import { authToken } from '@/api/authToken'
import type { AuthUser } from '@/types/user'

export type { AuthUser }

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshToken: () => Promise<string | null>
  fetchCurrentUser: () => Promise<void>
  restoreSession: () => Promise<void>
  setAccessToken: (token: string) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: false,

  login: async (username: string, password: string) => {
    set({ isLoading: true })
    try {
      // OAuth2PasswordRequestForm requires form-encoded data, NOT JSON
      const formData = new URLSearchParams()
      formData.append('username', username)
      formData.append('password', password)

      const response = await client.post<{
        access_token: string
        token_type: string
        user: AuthUser
      }>('/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })

      const { access_token, user } = response.data

      // Sync token to singleton so client.ts interceptor can access it
      authToken.set(access_token)

      set({
        accessToken: access_token,
        user,
        isAuthenticated: true,
        isLoading: false,
      })
    } catch (error) {
      authToken.set(null)
      set({
        accessToken: null,
        user: null,
        isAuthenticated: false,
        isLoading: false,
      })
      throw error
    }
  },

  logout: async () => {
    try {
      await client.post('/auth/logout')
    } catch {
      // Always clear auth state, even if the request fails
    } finally {
      authToken.set(null)
      set({
        user: null,
        accessToken: null,
        isAuthenticated: false,
      })
    }
  },

  refreshToken: async () => {
    try {
      const response = await client.post<{ access_token: string; token_type: string }>(
        '/auth/refresh'
      )
      const { access_token } = response.data
      authToken.set(access_token)
      set({ accessToken: access_token })
      return access_token
    } catch {
      return null
    }
  },

  fetchCurrentUser: async () => {
    try {
      const response = await client.get<AuthUser>('/auth/me')
      const user = response.data
      set({
        user,
        isAuthenticated: get().accessToken !== null,
      })
    } catch {
      authToken.set(null)
      set({
        user: null,
        accessToken: null,
        isAuthenticated: false,
      })
    }
  },

  setAccessToken: (token: string) => {
    authToken.set(token)
    set({ accessToken: token })
  },

  restoreSession: async () => {
    const state = get()
    if (state.accessToken) {
      // 메모리에 토큰이 있으면 유저 정보만 갱신
      await state.fetchCurrentUser()
      return
    }
    // 새로고침으로 메모리 토큰이 사라진 경우,
    // HTTP-only 쿠키의 refresh token으로 세션 복원 시도
    set({ isLoading: true })
    try {
      const newToken = await state.refreshToken()
      if (newToken) {
        await state.fetchCurrentUser()
      }
    } finally {
      set({ isLoading: false })
    }
  },

  clearAuth: () => {
    authToken.set(null)
    set({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    })
  },
}))

// -------------------------------------------------------------------------
// Register refresh and clearAuth callbacks on the authToken singleton.
// This allows client.ts response interceptor to call back into the store
// without creating a circular module dependency.
// -------------------------------------------------------------------------
authToken.setRefreshCallback(() => useAuthStore.getState().refreshToken())
authToken.setClearCallback(() => useAuthStore.getState().clearAuth())
