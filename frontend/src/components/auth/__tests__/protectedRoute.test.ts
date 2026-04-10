import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockGet = vi.fn()
const mockPost = vi.fn()

vi.mock('@/api/client', () => ({
  default: {
    get: mockGet,
    post: mockPost,
  },
}))

describe('ProtectedRoute auth logic (cookie-only store behavior)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('defaults to unauthenticated', async () => {
    const { useAuthStore } = await import('@/stores/useAuthStore')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().isLoading).toBe(false)
  })

  it('becomes authenticated after successful fetchCurrentUser', async () => {
    mockGet.mockResolvedValueOnce({
      data: { id: 1, userid: 'admin', roles: ['admin'] },
    })

    const { useAuthStore } = await import('@/stores/useAuthStore')
    await useAuthStore.getState().fetchCurrentUser()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('becomes unauthenticated when fetchCurrentUser fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('unauthorized'))

    const { useAuthStore } = await import('@/stores/useAuthStore')
    useAuthStore.setState({
      user: { id: 1, userid: 'admin', roles: ['admin'], line_id: null },
      accessToken: null,
      isAuthenticated: true,
      isLoading: false,
    })
    await useAuthStore.getState().fetchCurrentUser()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('restoreSession toggles loading and resolves to authenticated when /auth/me succeeds', async () => {
    mockGet.mockResolvedValueOnce({
      data: { id: 2, userid: 'editor', roles: ['editor'] },
    })

    const { useAuthStore } = await import('@/stores/useAuthStore')
    await useAuthStore.getState().restoreSession()
    expect(useAuthStore.getState().isLoading).toBe(false)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('clearAuth forces unauthenticated state', async () => {
    const { useAuthStore } = await import('@/stores/useAuthStore')
    useAuthStore.setState({
      user: { id: 10, userid: 'reviewer', roles: ['reviewer'], line_id: null },
      accessToken: null,
      isAuthenticated: true,
      isLoading: false,
    })
    useAuthStore.getState().clearAuth()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
