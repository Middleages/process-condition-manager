import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockPost = vi.fn()
const mockGet = vi.fn()

vi.mock('@/api/client', () => ({
  default: {
    post: mockPost,
    get: mockGet,
  },
}))

describe('useAuthStore (cookie-only auth mode)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('initializes with unauthenticated state', async () => {
    const { useAuthStore } = await import('@/stores/useAuthStore')
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().isLoading).toBe(false)
  })

  it('login does not use token API in node test env', async () => {
    const { useAuthStore } = await import('@/stores/useAuthStore')
    await useAuthStore.getState().login('admin', 'pass')

    // node 환경에서는 window가 없으므로 redirect 분기 미실행
    expect(mockPost).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().accessToken).toBeNull()
  })

  it('logout always clears auth state even when API fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('network'))

    const { useAuthStore } = await import('@/stores/useAuthStore')
    useAuthStore.setState({
      user: { id: 1, userid: 'editor', roles: ['editor'], line_id: null },
      accessToken: null,
      isAuthenticated: true,
      isLoading: false,
    })

    await useAuthStore.getState().logout()
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('refreshToken returns null in cookie-only mode', async () => {
    const { useAuthStore } = await import('@/stores/useAuthStore')
    const token = await useAuthStore.getState().refreshToken()
    expect(token).toBeNull()
    expect(mockPost).not.toHaveBeenCalledWith('/auth/refresh')
  })

  it('fetchCurrentUser sets authenticated state on success', async () => {
    const user = { id: 2, userid: 'reviewer', roles: ['reviewer'] }
    mockGet.mockResolvedValueOnce({ data: user })

    const { useAuthStore } = await import('@/stores/useAuthStore')
    await useAuthStore.getState().fetchCurrentUser()

    expect(useAuthStore.getState().user).toEqual(user)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().accessToken).toBeNull()
  })

  it('fetchCurrentUser clears auth on failure', async () => {
    mockGet.mockRejectedValueOnce(new Error('unauthorized'))

    const { useAuthStore } = await import('@/stores/useAuthStore')
    useAuthStore.setState({
      user: { id: 9, userid: 'x', roles: ['admin'], line_id: null },
      accessToken: null,
      isAuthenticated: true,
      isLoading: false,
    })

    await useAuthStore.getState().fetchCurrentUser()
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('setAccessToken does not store token in cookie-only mode', async () => {
    const { useAuthStore } = await import('@/stores/useAuthStore')
    useAuthStore.getState().setAccessToken('dummy-token')
    expect(useAuthStore.getState().accessToken).toBeNull()
  })

  it('restoreSession toggles loading around fetchCurrentUser', async () => {
    mockGet.mockResolvedValueOnce({
      data: { id: 3, userid: 'dev', roles: ['developer'] },
    })

    const { useAuthStore } = await import('@/stores/useAuthStore')
    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().isLoading).toBe(false)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})
