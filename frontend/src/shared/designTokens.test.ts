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
  it('defines the approved Signal Grid palette', () => {
    expect(css).toContain('--color-ink-950: #171916')
    expect(css).toContain('--color-brand-700: #2864dc')
    expect(css).toContain('--color-canvas: #f3f1ea')
    expect(css).toContain('--color-surface: #fbfaf6')
    expect(css).not.toContain('--color-draft-')
    expect(css).toContain('--color-success: #166534')
    expect(css).toContain('--color-success-surface: #dcfce7')
    expect(css).toContain('--color-warning: #92400e')
    expect(css).toContain('--color-warning-surface: #fef3c7')
    expect(css).toContain('--color-error: #b91c1c')
    expect(css).toContain('--color-error-surface: #fef2f2')
  })

  it('defines separate light and dark focus indicators', () => {
    expect(css).toContain('--focus-light: #ef5b2a')
    expect(css).toContain('--focus-dark: #ffb49d')
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
