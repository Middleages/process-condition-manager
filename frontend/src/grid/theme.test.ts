import { describe, expect, it } from 'vitest'

import glideSource from './GlideConditionGrid.tsx?raw'
import { GRID_COLORS } from './theme'

describe('GRID_COLORS', () => {
  it('locks the Canvas palette to the approved V1 tokens', () => {
    expect(GRID_COLORS).toEqual({
      ink: '#172f35',
      brand: '#0f766e',
      brandAccent: '#14b8a6',
      brandSubtle: '#ccfbf1',
      canvas: '#f4f7f8',
      surface: '#ffffff',
      border: '#d7e1e5',
      muted: '#52656a',
      success: '#166534',
      successSurface: '#dcfce7',
      warning: '#92400e',
      warningSurface: '#fef3c7',
      error: '#b91c1c',
      errorSurface: '#fef2f2',
    })
  })

  it('keeps Glide mapping inside the adapter and removes the retired raw palette', () => {
    expect(glideSource).toContain("import { GRID_COLORS } from './theme'")
    expect(glideSource).toContain('theme={GLIDE_THEME}')
    expect(glideSource).toContain('accentColor: GRID_COLORS.brand')
    expect(glideSource).toContain('bgCell: GRID_COLORS.surface')
    expect(glideSource).toContain('borderColor: GRID_COLORS.border')
    expect(glideSource).toContain(
      "{ id: IDENTITY_COLUMNS[3].id, title: IDENTITY_COLUMNS[3].title, width: 64 }",
    )
    expect(glideSource).toContain('bgCell: GRID_COLORS.successSurface')
    expect(glideSource).toContain('bgCell: GRID_COLORS.warningSurface')
    expect(glideSource).toContain('bgCell: GRID_COLORS.errorSurface')
    expect(glideSource).toContain('if (readOnly) return false')
    expect(glideSource).toMatch(
      /useIsomorphicLayoutEffect\(\(\) => \{\s*commitPasteCallbackRuntime\(pasteCallbackRuntimeRef/,
    )
    expect(glideSource).not.toContain('pasteCallbackRuntimeRef.current =')
    expect(glideSource).toMatch(
      /isCurrentPasteCallback\([\s\S]*?pasteCallbackGeneration[\s\S]*?current\.generation[\s\S]*?!current\.readOnly[\s\S]*?\)[\s\S]*?resolveCellTarget/,
    )
    expect(glideSource).not.toMatch(
      /#(?:0891b2|0f172a|94a3b8|f1f5f9|f8fafc|ecfdf5|fffbeb|eff6ff)/i,
    )
  })
})
