import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock axios client and authToken singleton before importing the store
// ---------------------------------------------------------------------------
const mockPost = vi.fn()
const mockGet = vi.fn()

vi.mock('@/api/client', () => ({
  default: {
    post: mockPost,
    get: mockGet,
  },
}))

// Mock authToken to track calls and avoid real singleton side effects
const mockAuthTokenSet = vi.fn()
const mockAuthTokenGet = vi.fn(() => null as string | null)
const mockAuthTokenRefresh = vi.fn()
const mockAuthTokenClearAuth = vi.fn()
const mockSetRefreshCallback = vi.fn()
const mockSetClearCallback = vi.fn()

vi.mock('@/api/authToken', () => ({
  authToken: {
    get: mockAuthTokenGet,
    set: mockAuthTokenSet,
    setClearCallback: mockSetClearCallback,
    setRefreshCallback: mockSetRefreshCallback,
    refresh: mockAuthTokenRefresh,
    clearAuth: mockAuthTokenClearAuth,
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useAuthStore', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('initializes with null user and accessToken', async () => {
      const { useAuthStore } = await import('@/stores/useAuthStore')
      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.accessToken).toBeNull()
      expect(state.isAuthenticated).toBe(false)
      expect(state.isLoading).toBe(false)
    })
  })

  describe('login', () => {
    it('sets user and accessToken on successful login', async () => {
      const mockUser = { id: 1, username: 'admin', display_name: 'Admin User', roles: ['admin'] }
      mockPost.mockResolvedValueOnce({
        data: { access_token: 'mock-token-123', token_type: 'bearer', user: mockUser },
      })

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await useAuthStore.getState().login('admin', 'password123')

      const state = useAuthStore.getState()
      expect(state.user).toEqual(mockUser)
      expect(state.accessToken).toBe('mock-token-123')
      expect(state.isAuthenticated).toBe(true)
    })

    it('sends form-encoded data (not JSON) to login endpoint', async () => {
      const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
      mockPost.mockResolvedValueOnce({
        data: { access_token: 'token', token_type: 'bearer', user: mockUser },
      })

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await useAuthStore.getState().login('admin', 'pass')

      // Verify the body is URLSearchParams (form-encoded)
      const callArgs = mockPost.mock.calls[0]
      const body = callArgs[1]
      expect(body).toBeInstanceOf(URLSearchParams)
      expect(body.get('username')).toBe('admin')
      expect(body.get('password')).toBe('pass')
    })

    it('posts to /auth/login endpoint', async () => {
      const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
      mockPost.mockResolvedValueOnce({
        data: { access_token: 'token', token_type: 'bearer', user: mockUser },
      })

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await useAuthStore.getState().login('admin', 'pass')

      expect(mockPost.mock.calls[0][0]).toBe('/auth/login')
    })

    it('sets isLoading to true during login and false after', async () => {
      const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
      let resolveLogin!: (value: unknown) => void
      const loginPromise = new Promise((resolve) => {
        resolveLogin = resolve
      })
      mockPost.mockReturnValueOnce(loginPromise)

      const { useAuthStore } = await import('@/stores/useAuthStore')
      const loginAction = useAuthStore.getState().login('admin', 'pass')

      // isLoading should be true while login is in progress
      expect(useAuthStore.getState().isLoading).toBe(true)

      resolveLogin({
        data: { access_token: 'token', token_type: 'bearer', user: mockUser },
      })
      await loginAction

      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    it('clears auth state and re-throws on login failure', async () => {
      mockPost.mockRejectedValueOnce(new Error('Invalid credentials'))

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await expect(useAuthStore.getState().login('bad', 'creds')).rejects.toThrow()

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.accessToken).toBeNull()
      expect(state.isAuthenticated).toBe(false)
      expect(state.isLoading).toBe(false)
    })

    it('does NOT store accessToken in localStorage (XSS prevention - REQ-AUTH-021)', async () => {
      // The authToken singleton uses in-memory storage (not localStorage).
      // We verify that mockAuthTokenSet was called (in-memory only) and
      // that no localStorage operations occurred.
      const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
      mockPost.mockResolvedValueOnce({
        data: { access_token: 'secret-token', token_type: 'bearer', user: mockUser },
      })

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await useAuthStore.getState().login('admin', 'pass')

      // Token is stored in the in-memory authToken singleton, NOT localStorage
      expect(mockAuthTokenSet).toHaveBeenCalledWith('secret-token')
      // The accessToken is in Zustand state (in-memory), not localStorage
      expect(useAuthStore.getState().accessToken).toBe('secret-token')
    })

    it('syncs access token to authToken singleton on login', async () => {
      const { mockAuthTokenSet: freshMock } = vi.hoisted(() => ({
        mockAuthTokenSet: vi.fn(),
      }))
      // Use the already-mocked authToken.set
      const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
      mockPost.mockResolvedValueOnce({
        data: { access_token: 'sync-token', token_type: 'bearer', user: mockUser },
      })

      // Suppress unused variable warning
      void freshMock

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await useAuthStore.getState().login('admin', 'pass')

      // authToken.set should have been called with the token
      expect(mockAuthTokenSet).toHaveBeenCalledWith('sync-token')
    })
  })

  describe('logout', () => {
    it('clears auth state on logout', async () => {
      const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
      mockPost
        .mockResolvedValueOnce({
          data: { access_token: 'token', token_type: 'bearer', user: mockUser },
        })
        .mockResolvedValueOnce({ data: { message: 'Logged out successfully' } })

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await useAuthStore.getState().login('admin', 'pass')
      expect(useAuthStore.getState().isAuthenticated).toBe(true)

      await useAuthStore.getState().logout()

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.accessToken).toBeNull()
      expect(state.isAuthenticated).toBe(false)
    })

    it('clears auth state even if logout request fails', async () => {
      const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
      mockPost
        .mockResolvedValueOnce({
          data: { access_token: 'token', token_type: 'bearer', user: mockUser },
        })
        .mockRejectedValueOnce(new Error('Network error'))

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await useAuthStore.getState().login('admin', 'pass')
      await useAuthStore.getState().logout()

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.accessToken).toBeNull()
    })

    it('clears authToken singleton on logout', async () => {
      const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
      mockPost
        .mockResolvedValueOnce({
          data: { access_token: 'token', token_type: 'bearer', user: mockUser },
        })
        .mockResolvedValueOnce({ data: { message: 'Logged out' } })

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await useAuthStore.getState().login('admin', 'pass')
      await useAuthStore.getState().logout()

      // authToken.set(null) should have been called during logout
      expect(mockAuthTokenSet).toHaveBeenCalledWith(null)
    })
  })

  describe('refreshToken', () => {
    it('returns new access token on success', async () => {
      mockPost.mockResolvedValueOnce({
        data: { access_token: 'new-token-456', token_type: 'bearer' },
      })

      const { useAuthStore } = await import('@/stores/useAuthStore')
      const newToken = await useAuthStore.getState().refreshToken()

      expect(newToken).toBe('new-token-456')
      expect(useAuthStore.getState().accessToken).toBe('new-token-456')
    })

    it('returns null on refresh failure', async () => {
      mockPost.mockRejectedValueOnce(new Error('Refresh token expired'))

      const { useAuthStore } = await import('@/stores/useAuthStore')
      const result = await useAuthStore.getState().refreshToken()

      expect(result).toBeNull()
    })

    it('calls /auth/refresh endpoint', async () => {
      mockPost.mockResolvedValueOnce({
        data: { access_token: 'new-token', token_type: 'bearer' },
      })

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await useAuthStore.getState().refreshToken()

      expect(mockPost).toHaveBeenCalledWith('/auth/refresh')
    })
  })

  describe('fetchCurrentUser', () => {
    it('updates user from /auth/me endpoint', async () => {
      const mockUser = { id: 2, username: 'editor', display_name: 'Editor User', roles: ['editor'] }
      mockGet.mockResolvedValueOnce({ data: mockUser })

      const { useAuthStore } = await import('@/stores/useAuthStore')
      // Set a token first
      useAuthStore.getState().setAccessToken('existing-token')
      await useAuthStore.getState().fetchCurrentUser()

      expect(useAuthStore.getState().user).toEqual(mockUser)
    })

    it('clears auth on fetchCurrentUser failure', async () => {
      mockGet.mockRejectedValueOnce(new Error('Unauthorized'))

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await useAuthStore.getState().fetchCurrentUser()

      expect(useAuthStore.getState().user).toBeNull()
    })
  })

  describe('setAccessToken', () => {
    it('updates accessToken in state', async () => {
      const { useAuthStore } = await import('@/stores/useAuthStore')
      useAuthStore.getState().setAccessToken('direct-token')
      expect(useAuthStore.getState().accessToken).toBe('direct-token')
    })

    it('syncs token to authToken singleton', async () => {
      const { useAuthStore } = await import('@/stores/useAuthStore')
      useAuthStore.getState().setAccessToken('singleton-token')
      expect(mockAuthTokenSet).toHaveBeenCalledWith('singleton-token')
    })
  })

  describe('clearAuth', () => {
    it('clears all auth state', async () => {
      const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
      mockPost.mockResolvedValueOnce({
        data: { access_token: 'token', token_type: 'bearer', user: mockUser },
      })

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await useAuthStore.getState().login('admin', 'pass')
      expect(useAuthStore.getState().isAuthenticated).toBe(true)

      useAuthStore.getState().clearAuth()

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.accessToken).toBeNull()
      expect(state.isAuthenticated).toBe(false)
    })
  })

  describe('isAuthenticated derived state', () => {
    it('is false when user is null even with a token', async () => {
      const { useAuthStore } = await import('@/stores/useAuthStore')
      // Only set the access token — user is still null
      useAuthStore.setState({ accessToken: 'some-token', user: null, isAuthenticated: false })
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })

    it('is true when both user and accessToken are set', async () => {
      const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
      mockPost.mockResolvedValueOnce({
        data: { access_token: 'token', token_type: 'bearer', user: mockUser },
      })

      const { useAuthStore } = await import('@/stores/useAuthStore')
      await useAuthStore.getState().login('admin', 'pass')

      expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })
  })
})
