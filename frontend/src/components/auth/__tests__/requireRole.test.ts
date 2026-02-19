import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock useAuthStore
const mockUseAuthStore = vi.fn()
vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => mockUseAuthStore(selector),
}))

describe('RequireRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders children when user role is in allowedRoles', async () => {
    mockUseAuthStore.mockImplementation((selector: (s: { user: { role: string } }) => unknown) =>
      selector({ user: { role: 'admin' } })
    )

    const { default: RequireRole } = await import('../RequireRole')
    const { createElement } = await import('react')
    const { renderToString } = await import('react-dom/server')

    const result = renderToString(
      createElement(RequireRole, { allowedRoles: ['admin', 'reviewer'] }, createElement('span', null, 'visible'))
    )
    expect(result).toContain('visible')
  })

  it('does not render children when user role is not allowed', async () => {
    mockUseAuthStore.mockImplementation((selector: (s: { user: { role: string } }) => unknown) =>
      selector({ user: { role: 'editor' } })
    )

    const { default: RequireRole } = await import('../RequireRole')
    const { createElement } = await import('react')
    const { renderToString } = await import('react-dom/server')

    const result = renderToString(
      createElement(RequireRole, { allowedRoles: ['admin'] }, createElement('span', null, 'hidden'))
    )
    expect(result).not.toContain('hidden')
  })

  it('renders fallback when user role is not allowed', async () => {
    mockUseAuthStore.mockImplementation((selector: (s: { user: { role: string } }) => unknown) =>
      selector({ user: { role: 'editor' } })
    )

    const { default: RequireRole } = await import('../RequireRole')
    const { createElement } = await import('react')
    const { renderToString } = await import('react-dom/server')

    const result = renderToString(
      createElement(
        RequireRole,
        { allowedRoles: ['admin'], fallback: createElement('span', null, 'no-access') },
        createElement('span', null, 'hidden')
      )
    )
    expect(result).toContain('no-access')
    expect(result).not.toContain('hidden')
  })

  it('does not render children when user is null', async () => {
    mockUseAuthStore.mockImplementation((selector: (s: { user: null }) => unknown) =>
      selector({ user: null })
    )

    const { default: RequireRole } = await import('../RequireRole')
    const { createElement } = await import('react')
    const { renderToString } = await import('react-dom/server')

    const result = renderToString(
      createElement(RequireRole, { allowedRoles: ['admin'] }, createElement('span', null, 'hidden'))
    )
    expect(result).not.toContain('hidden')
  })
})
