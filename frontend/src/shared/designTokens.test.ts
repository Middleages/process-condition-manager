import { describe, expect, it } from 'vitest'
import importedCss from '../styles.css?raw'

declare const process: {
  getBuiltinModule(module: 'fs'): {
    readFileSync(path: URL, encoding: 'utf8'): string
  }
}

// Vitest stubs CSS imports when CSS processing is disabled, even with `?raw`.
// Read the source in that environment so this remains a source-level token contract.
const css =
  importedCss || process.getBuiltinModule('fs').readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

describe('design tokens', () => {
  it('defines the approved Precision Teal palette', () => {
    expect(css).toContain('--color-ink-950: #172f35')
    expect(css).toContain('--color-brand-700: #0f766e')
    expect(css).toContain('--color-brand-500: #14b8a6')
    expect(css).toContain('--color-canvas: #f4f7f8')
    expect(css).toContain('--color-border-control: #81979e')
    expect(css).toContain('--color-muted: #52656a')
    expect(css).toContain('--color-success: #166534')
    expect(css).toContain('--color-success-surface: #dcfce7')
    expect(css).toContain('--color-warning: #92400e')
    expect(css).toContain('--color-warning-surface: #fef3c7')
    expect(css).toContain('--color-error: #b91c1c')
    expect(css).toContain('--color-error-surface: #fef2f2')
  })

  it('defines separate light and dark focus indicators', () => {
    expect(css).toContain('--focus-light: #0f766e')
    expect(css).toContain('--focus-dark: #14b8a6')
  })

  it('provides a reduced-motion fallback', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
