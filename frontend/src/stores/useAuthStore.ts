import { create } from 'zustand'
import client from '@/api/client'
import { authToken } from '@/api/authToken'

export interface AuthUser {
  id: number
  username: string
  display_name: string
  role: string
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshToken: () => Promise<string | null>
  fetchCurrentUser: () => Promise<void>
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
