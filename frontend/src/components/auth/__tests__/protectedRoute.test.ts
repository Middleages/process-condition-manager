import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for ProtectedRoute logic via useAuthStore state
// Since vitest environment is 'node', we test the store logic
// that drives ProtectedRoute behavior.
// ---------------------------------------------------------------------------

const mockPost = vi.fn()
const mockGet = vi.fn()

vi.mock('@/api/client', () => ({
  default: {
    post: mockPost,
    get: mockGet,
  },
}))

describe('ProtectedRoute auth logic (via useAuthStore)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('isAuthenticated is false by default (unauthenticated user should be redirected)', async () => {
    const { useAuthStore } = await import('@/stores/useAuthStore')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().isLoading).toBe(false)
  })

  it('isAuthenticated becomes true after successful login (user should be allowed through)', async () => {
    const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
    mockPost.mockResolvedValueOnce({
      data: { access_token: 'token', token_type: 'bearer', user: mockUser },
    })

    const { useAuthStore } = await import('@/stores/useAuthStore')
    await useAuthStore.getState().login('admin', 'pass')

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('isAuthenticated becomes false after logout (user should be redirected)', async () => {
    const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
    mockPost
      .mockResolvedValueOnce({
        data: { access_token: 'token', token_type: 'bearer', user: mockUser },
      })
      .mockResolvedValueOnce({ data: { message: 'Logged out' } })

    const { useAuthStore } = await import('@/stores/useAuthStore')
    await useAuthStore.getState().login('admin', 'pass')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    await useAuthStore.getState().logout()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('isLoading is true during login (spinner should be shown)', async () => {
    const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
    let resolveLogin!: (value: unknown) => void
    const loginPromise = new Promise((resolve) => {
      resolveLogin = resolve
    })
    mockPost.mockReturnValueOnce(loginPromise)

    const { useAuthStore } = await import('@/stores/useAuthStore')
    const loginAction = useAuthStore.getState().login('admin', 'pass')

    // While login is in-flight, isLoading should be true
    expect(useAuthStore.getState().isLoading).toBe(true)

    resolveLogin({
      data: { access_token: 'token', token_type: 'bearer', user: mockUser },
    })
    await loginAction

    // After login completes, isLoading should be false
    expect(useAuthStore.getState().isLoading).toBe(false)
  })

  it('clearAuth sets isAuthenticated to false (forced logout should redirect)', async () => {
    const mockUser = { id: 1, username: 'admin', display_name: 'Admin', roles: ['admin'] }
    mockPost.mockResolvedValueOnce({
      data: { access_token: 'token', token_type: 'bearer', user: mockUser },
    })

    const { useAuthStore } = await import('@/stores/useAuthStore')
    await useAuthStore.getState().login('admin', 'pass')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    useAuthStore.getState().clearAuth()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
