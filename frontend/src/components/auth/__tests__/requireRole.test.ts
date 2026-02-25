import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock useAuthStore
const mockUseAuthStore = vi.fn()
vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => mockUseAuthStore(selector),
}))

// Mock permissions (hasAnyRole)
vi.mock('@/lib/permissions', () => ({
  hasAnyRole: (roles: string[] | undefined, required: string[]) =>
    required.some(r => roles?.includes(r) ?? false),
}))

describe('RequireRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders children when user roles include an allowed role', async () => {
    mockUseAuthStore.mockImplementation((selector: (s: { user: { roles: string[] } }) => unknown) =>
      selector({ user: { roles: ['admin', 'editor'] } })
    )

    const { default: RequireRole } = await import('../RequireRole')
    const { createElement } = await import('react')
    const { renderToString } = await import('react-dom/server')

    const result = renderToString(
      createElement(RequireRole, { allowedRoles: ['admin', 'reviewer'] }, createElement('span', null, 'visible'))
    )
    expect(result).toContain('visible')
  })

  it('does not render children when user roles do not include any allowed role', async () => {
    mockUseAuthStore.mockImplementation((selector: (s: { user: { roles: string[] } }) => unknown) =>
      selector({ user: { roles: ['editor'] } })
    )

    const { default: RequireRole } = await import('../RequireRole')
    const { createElement } = await import('react')
    const { renderToString } = await import('react-dom/server')

    const result = renderToString(
      createElement(RequireRole, { allowedRoles: ['admin'] }, createElement('span', null, 'hidden'))
    )
    expect(result).not.toContain('hidden')
  })

  it('renders fallback when user roles do not include any allowed role', async () => {
    mockUseAuthStore.mockImplementation((selector: (s: { user: { roles: string[] } }) => unknown) =>
      selector({ user: { roles: ['editor'] } })
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

  it('renders children when user has developer role and developer is allowed', async () => {
    mockUseAuthStore.mockImplementation((selector: (s: { user: { roles: string[] } }) => unknown) =>
      selector({ user: { roles: ['developer'] } })
    )

    const { default: RequireRole } = await import('../RequireRole')
    const { createElement } = await import('react')
    const { renderToString } = await import('react-dom/server')

    const result = renderToString(
      createElement(RequireRole, { allowedRoles: ['admin', 'developer'] }, createElement('span', null, 'visible'))
    )
    expect(result).toContain('visible')
  })
})
