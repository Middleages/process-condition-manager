import { describe, expect, it, vi } from 'vitest'

import goldenCases from './golden-cases.json'
import { compilePortablePattern } from './pattern'

describe('portable pattern contract', () => {
  it.each(goldenCases.pattern_vectors)('$name', (vector) => {
    if (!vector.valid) {
      expect(() => compilePortablePattern(vector.source)).toThrowError(
        expect.objectContaining({ code: 'portable_pattern_invalid' }),
      )
      return
    }

    const pattern = compilePortablePattern(vector.source)
    for (const value of vector.accepted) expect(pattern.matches(value)).toBe(true)
    for (const value of vector.rejected) expect(pattern.matches(value)).toBe(false)
  })

  it('rejects a final newline despite JavaScript dollar-anchor semantics', () => {
    expect(compilePortablePattern('ABC').matches('ABC\n')).toBe(false)
  })

  it('rejects an overlong value without invoking the host regular expression', () => {
    const pattern = compilePortablePattern('[A-Z]{1,3}')
    const exec = vi.spyOn(RegExp.prototype, 'exec')

    expect(pattern.matches('ABCD')).toBe(false)
    expect(exec).not.toHaveBeenCalled()

    exec.mockRestore()
  })

  it('counts Unicode code points rather than UTF-16 code units', () => {
    const astralClass = `[${'😀'.repeat(200)}]`

    expect(compilePortablePattern(astralClass).matches('😀')).toBe(true)
    expect(compilePortablePattern('.').matches('😀')).toBe(true)
  })

  it('gives dot Python semantics for non-newline Unicode line separators', () => {
    const pattern = compilePortablePattern('.')

    expect(pattern.matches('\r')).toBe(true)
    expect(pattern.matches('\u2028')).toBe(true)
    expect(pattern.matches('\u2029')).toBe(true)
    expect(pattern.matches('\n')).toBe(false)
  })

  it('preserves escaped hyphens and escaped-backslash context in Unicode mode', () => {
    expect(compilePortablePattern(String.raw`\-`).matches('-')).toBe(true)
    expect(compilePortablePattern(String.raw`\\-`).matches(String.raw`\-`)).toBe(true)
  })
})
