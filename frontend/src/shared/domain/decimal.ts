export type DecimalInputResult =
  | { kind: 'empty'; value: null }
  | { kind: 'valid'; value: string }
  | { kind: 'invalid'; reason: 'format' | 'too_long' | 'too_many_digits' }

const DECIMAL_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/

export function normalizeDecimalInput(raw: string): DecimalInputResult {
  const text = raw.trim()
  if (text === '') return { kind: 'empty', value: null }
  if (text.length > 256) return { kind: 'invalid', reason: 'too_long' }
  if (!DECIMAL_PATTERN.test(text)) return { kind: 'invalid', reason: 'format' }
  if ([...text].filter((char) => char >= '0' && char <= '9').length > 128) {
    return { kind: 'invalid', reason: 'too_many_digits' }
  }

  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const [rawInteger = '', rawFraction = ''] = unsigned.split('.', 2)
  const integer = rawInteger.replace(/^0+(?=\d)/, '') || '0'
  const fraction = rawFraction.replace(/0+$/, '')
  const canonical = fraction === '' ? integer : `${integer}.${fraction}`
  return { kind: 'valid', value: canonical === '0' ? '0' : negative ? `-${canonical}` : canonical }
}

export function compareCanonicalDecimals(left: string, right: string): -1 | 0 | 1 {
  const a = requireCanonical(left)
  const b = requireCanonical(right)
  if (a.negative !== b.negative) return a.negative ? -1 : 1
  const magnitude = compareMagnitude(a.integer, a.fraction, b.integer, b.fraction)
  return a.negative ? invert(magnitude) : magnitude
}

function requireCanonical(raw: string) {
  const result = normalizeDecimalInput(raw)
  if (result.kind !== 'valid') throw new Error(`Invalid decimal: ${raw}`)
  const negative = result.value.startsWith('-')
  const [integer, fraction = ''] = (negative ? result.value.slice(1) : result.value).split('.', 2)
  return { negative, integer, fraction }
}

function compareMagnitude(ai: string, af: string, bi: string, bf: string): -1 | 0 | 1 {
  if (ai.length !== bi.length) return ai.length < bi.length ? -1 : 1
  if (ai !== bi) return ai < bi ? -1 : 1
  const width = Math.max(af.length, bf.length)
  const left = af.padEnd(width, '0')
  const right = bf.padEnd(width, '0')
  return left === right ? 0 : left < right ? -1 : 1
}

function invert(value: -1 | 0 | 1): -1 | 0 | 1 {
  return value === 0 ? 0 : value === 1 ? -1 : 1
}
