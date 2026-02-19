import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// useUserStore is now a bridge over useAuthStore.
// Mock the auth store to control its state.
// ---------------------------------------------------------------------------

const mockPost = vi.fn()
const mockGet = vi.fn()

vi.mock('@/api/client', () => ({
  default: {
    post: mockPost,
    get: mockGet,
  },
}))

describe('useUserStore (auth bridge)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('currentUserId is null when not authenticated', async () => {
    const { useUserStore } = await import('@/stores/useUserStore')
    expect(useUserStore.getState().currentUserId).toBeNull()
  })

  it('currentUserId reflects the logged-in user id', async () => {
    const mockUser = { id: 5, username: 'editor', display_name: 'Editor', role: 'editor' }
    mockPost.mockResolvedValueOnce({
      data: { access_token: 'token', token_type: 'bearer', user: mockUser },
    })

    const { useAuthStore } = await import('@/stores/useAuthStore')
    const { useUserStore } = await import('@/stores/useUserStore')

    await useAuthStore.getState().login('editor', 'pass')

    expect(useUserStore.getState().currentUserId).toBe(5)
  })

  it('currentUserId becomes null after logout', async () => {
    const mockUser = { id: 5, username: 'editor', display_name: 'Editor', role: 'editor' }
    mockPost
      .mockResolvedValueOnce({
        data: { access_token: 'token', token_type: 'bearer', user: mockUser },
      })
      .mockResolvedValueOnce({ data: { message: 'Logged out' } })

    const { useAuthStore } = await import('@/stores/useAuthStore')
    const { useUserStore } = await import('@/stores/useUserStore')

    await useAuthStore.getState().login('editor', 'pass')
    expect(useUserStore.getState().currentUserId).toBe(5)

    await useAuthStore.getState().logout()
    expect(useUserStore.getState().currentUserId).toBeNull()
  })

  it('setCurrentUserId is a no-op (backward compat, does not crash)', async () => {
    const { useUserStore } = await import('@/stores/useUserStore')
    // Should not throw
    expect(() => useUserStore.getState().setCurrentUserId(42)).not.toThrow()
    expect(() => useUserStore.getState().setCurrentUserId(null)).not.toThrow()
  })

  it('does NOT use localStorage for user persistence', async () => {
    // setCurrentUserId is a no-op — it does not persist to localStorage.
    // We verify by checking that setCurrentUserId does not change currentUserId
    // (since it's derived from useAuthStore, which starts with no user).
    const { useUserStore } = await import('@/stores/useUserStore')

    useUserStore.getState().setCurrentUserId(99)

    // currentUserId should still be null since no user is authenticated
    expect(useUserStore.getState().currentUserId).toBeNull()
  })
})
