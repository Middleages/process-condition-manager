import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthGuard } from './AuthGuard'
import { AuthProvider, useAuth } from './AuthContext'

import { defaultAuthState, type MeOut, resolveAuthPermissions } from '@/api/auth'

function buildUser(permissionSet: string[]): MeOut {
  return {
    id: 'user-1',
    display_name: 'Demo User',
    email: 'demo@example.com',
    roles: [],
    permissions: permissionSet,
  }
}

function AuthProbe() {
  const auth = useAuth()

  return (
    <div>
      <p data-testid="ready">{String(auth.ready)}</p>
      <p data-testid="user">{auth.user?.id ?? ''}</p>
      <p data-testid="can-edit-draft">{String(auth.permissions.canEditDraft)}</p>
      <p data-testid="can-approve">{String(auth.permissions.canApprove)}</p>
      <p data-testid="can-reject">{String(auth.permissions.canReject)}</p>
      <p data-testid="can-request-review">{String(auth.permissions.canRequestReview)}</p>
      <p data-testid="can-return-draft">{String(auth.permissions.canReturnToDraft)}</p>
      <p data-testid="can-create-revision">{String(auth.permissions.canCreateRevision)}</p>
      <p data-testid="can-comment">{String(auth.permissions.canComment)}</p>
      <p data-testid="error">{String(auth.error !== null)}</p>
    </div>
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('throws when useAuth is used without provider', () => {
    function UnauthorizedAuthUsage() {
      useAuth()

      return null
    }

    expect(() => renderToStaticMarkup(<UnauthorizedAuthUsage />)).toThrow(
      'AuthContext must be used within an AuthProvider',
    )
  })

  it('resolves permissions from authoritative permission strings', () => {
    const html = renderToStaticMarkup(
      <AuthProvider initialState={{
        user: buildUser(['project.edit', 'project.review.request', 'project.comment']),
        ready: true,
        permissions: resolveAuthPermissions({
          ...buildUser([]),
          permissions: ['project.edit', 'project.review.request', 'project.comment'],
        }),
      }}>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(html).toContain('<p data-testid="can-edit-draft">true</p>')
    expect(html).toContain('<p data-testid="can-request-review">true</p>')
    expect(html).toContain('<p data-testid="can-approve">false</p>')
    expect(html).toContain('<p data-testid="can-reject">false</p>')
    expect(html).toContain('<p data-testid="can-return-draft">true</p>')
    expect(html).toContain('<p data-testid="can-create-revision">false</p>')
    expect(html).toContain('<p data-testid="can-comment">true</p>')
    expect(html).toContain('<p data-testid="error">false</p>')
  })

  it('exposes provided initialState through useAuth', () => {
    const html = renderToStaticMarkup(
      <AuthProvider
        initialState={{
          user: buildUser(['project.edit']),
          ready: true,
          permissions: {
            canEditDraft: true,
            canRequestReview: true,
            canApprove: true,
            canReject: true,
            canReturnToDraft: true,
            canCreateRevision: true,
            canComment: true,
          },
        }}
      >
        <AuthProbe />
      </AuthProvider>,
    )

    expect(html).toContain('<p data-testid="ready">true</p>')
    expect(html).toContain('<p data-testid="user">user-1</p>')
    expect(html).toContain('<p data-testid="can-edit-draft">true</p>')
    expect(html).toContain('<p data-testid="can-approve">true</p>')
    expect(html).toContain('<p data-testid="can-reject">true</p>')
    expect(html).toContain('<p data-testid="can-request-review">true</p>')
    expect(html).toContain('<p data-testid="can-return-draft">true</p>')
    expect(html).toContain('<p data-testid="can-create-revision">true</p>')
    expect(html).toContain('<p data-testid="can-comment">true</p>')
    expect(html).toContain('<p data-testid="error">false</p>')
  })

  it('falls back to default permissions when initial state is omitted', () => {
    const html = renderToStaticMarkup(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(html).toContain('<p data-testid="ready">false</p>')
    expect(html).toContain('<p data-testid="user"></p>')
    expect(html).toContain(`<p data-testid="can-edit-draft">${String(defaultAuthState.permissions.canEditDraft)}</p>`)
    expect(html).toContain(`<p data-testid="can-comment">${String(defaultAuthState.permissions.canComment)}</p>`)
    expect(html).toContain('<p data-testid="error">false</p>')
  })

  it('with bootstrap error, hides children and offers retry', () => {
    const html = renderToStaticMarkup(
      <AuthGuard
        initialState={{
          ready: true,
          user: null,
          error: { response: { status: 401 } },
          permissions: defaultAuthState.permissions,
        }}
      >
        <p data-testid="guard-child">ok</p>
      </AuthGuard>,
    )

    expect(html).toContain('사용자 권한을 확인하지 못했습니다.')
    expect(html).toContain('다시 시도')
    expect(html).not.toContain('guard-child')
  })

  it('hides children while loading and renders them only when ready and user exists', () => {
    const loading = renderToStaticMarkup(
      <AuthGuard
        initialState={{
          ready: false,
          user: null,
          error: null,
          permissions: defaultAuthState.permissions,
        }}
      >
        <p data-testid="guard-child">ok</p>
      </AuthGuard>,
    )

    expect(loading).toContain('사용자 권한을 확인하고 있습니다.')
    expect(loading).not.toContain('guard-child')

    const ready = renderToStaticMarkup(
      <AuthGuard
        initialState={{
          ready: true,
          user: buildUser(['project.comment']),
          permissions: resolveAuthPermissions(buildUser(['project.comment'])),
          error: null,
        }}
      >
        <p data-testid="guard-child">ok</p>
      </AuthGuard>,
    )

    expect(ready).toContain('guard-child')
    expect(ready).not.toContain('다시 시도')
  })

  it('supports no-role users when permissions are empty and still allows authenticated access', () => {
    const html = renderToStaticMarkup(
      <AuthProvider
        initialState={{
          ready: true,
          user: buildUser([]),
          permissions: resolveAuthPermissions(buildUser([])),
        }}
      >
        <AuthProbe />
      </AuthProvider>,
    )

    expect(html).toContain('<p data-testid="ready">true</p>')
    expect(html).toContain('<p data-testid="can-edit-draft">false</p>')
    expect(html).toContain('<p data-testid="can-comment">false</p>')
  })

  it('does not render children while permission bootstrap is loading in AuthGuard', () => {
    const html = renderToStaticMarkup(<AuthGuard>{null}</AuthGuard>)

    expect(html).toContain('사용자 권한을 확인하고 있습니다.')
    expect(html).not.toContain('guard-child')
  })
})
