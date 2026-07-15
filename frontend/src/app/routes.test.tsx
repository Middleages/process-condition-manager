import { matchRoutes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { appRoutes } from './routes'

function leafPath(pathname: string): string | undefined {
  const matches = matchRoutes(appRoutes, pathname)
  return matches ? matches[matches.length - 1]?.route.path : undefined
}

function matchedShells(pathname: string): unknown[] {
  return (
    matchRoutes(appRoutes, pathname)?.map(
      (match) => (match.route.handle as { shell?: unknown } | undefined)?.shell,
    ) ?? []
  )
}

describe('app routes', () => {
  it('keeps the current primary routes reachable', () => {
    expect(leafPath('/projects')).toBe('projects')
    expect(leafPath('/projects/new')).toBe('projects/new')
    expect(leafPath('/projects/7')).toBe('projects/:projectId')
    expect(leafPath('/processes')).toBe('processes')
    expect(leafPath('/parameters')).toBe('parameters')
    expect(leafPath('/projects/7/sheet')).toBe('projects/:projectId/sheet')
  })

  it('isolates the sheet in the focus shell and keeps project pages in the normal shell', () => {
    expect(matchedShells('/projects/7/sheet')).toContain('focus')
    expect(matchedShells('/projects/7/sheet')).not.toContain('normal')

    for (const pathname of ['/projects', '/projects/new', '/projects/7']) {
      expect(matchedShells(pathname)).toContain('normal')
      expect(matchedShells(pathname)).not.toContain('focus')
    }
  })
})
