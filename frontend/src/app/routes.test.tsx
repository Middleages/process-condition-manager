import { matchRoutes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { appRoutes } from './routes'

function leafPath(pathname: string): string | undefined {
  const matches = matchRoutes(appRoutes, pathname)
  return matches ? matches[matches.length - 1]?.route.path : undefined
}

describe('app routes', () => {
  it('keeps the current primary routes reachable', () => {
    expect(leafPath('/projects')).toBe('projects')
    expect(leafPath('/processes')).toBe('processes')
    expect(leafPath('/parameters')).toBe('parameters')
    expect(leafPath('/projects/7/sheet')).toBe('projects/:projectId/sheet')
  })
})
