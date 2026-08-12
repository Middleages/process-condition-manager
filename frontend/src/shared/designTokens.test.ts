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
  it('defines the approved Drafting Table palette', () => {
    expect(css).toContain('--color-draft-canvas: #f7f7f3')
    expect(css).toContain('--color-draft-ink: #12232a')
    expect(css).toContain('--color-draft-teal: #196b67')
    expect(css).toContain('--color-draft-amber: #d18b2c')
    expect(css).toContain('--color-draft-rule: #cbd2cf')
    expect(css).toContain('--color-ink-950: var(--color-draft-ink)')
    expect(css).toContain('--color-brand-700: var(--color-draft-teal)')
    expect(css).toContain('--color-canvas: var(--color-draft-canvas)')
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
    expect(css).toContain('--focus-light: var(--color-draft-teal)')
    expect(css).toContain('--focus-dark: #69d4cc')
  })

  it('provides a reduced-motion fallback', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('keeps legacy control surfaces at a 36px border-box height', () => {
    for (const selector of ['.input', '.btn-primary', '.btn-secondary', '.btn-danger']) {
      const start = css.indexOf(`${selector} {`)
      const rule = css.slice(start, css.indexOf('}', start))

      expect(start, `${selector} rule`).toBeGreaterThanOrEqual(0)
      expect(rule, `${selector} box sizing`).toMatch(/\sbox-border(?:\s|;)/)
      expect(rule, `${selector} height`).toMatch(/\sh-9(?:\s|;)/)
      expect(rule, `${selector} minimum height`).not.toContain('min-h-')
    }
  })
})
