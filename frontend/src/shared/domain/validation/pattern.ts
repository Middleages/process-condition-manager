const MAX_PATTERN_LENGTH = 256
const MAX_ALTERNATIVES = 16
const MAX_ATOMS_PER_ALTERNATIVE = 64
const MAX_QUANTIFIED_ATOMS_PER_ALTERNATIVE = 16
const MAX_REPETITION = 256
const MAX_BRANCH_MATCH_LENGTH = 1_024

const ESCAPABLE_METACHARACTERS = new Set([...String.raw`.\^$*+?{}[]|()-`])
const FORBIDDEN_UNESCAPED = new Set([...String.raw`^$*+?{}()]`])

interface AcceptedCharacters {
  readonly intervals: readonly (readonly [number, number])[]
  readonly matchesAny: boolean
}

const ANY_CHARACTER: AcceptedCharacters = { intervals: [], matchesAny: true }

export interface PortablePattern {
  readonly source: string
  readonly maxMatchLength: number
  matches(value: string): boolean
}

export class PortablePatternError extends Error {
  readonly code = 'portable_pattern_invalid'

  constructor(diagnostic: string) {
    super(diagnostic)
    this.name = 'PortablePatternError'
  }
}

class PatternScanner {
  private readonly characters: readonly string[]
  private index = 0

  constructor(source: string) {
    this.characters = [...source]
  }

  scan(): number {
    const branchMaxima: number[] = []
    while (true) {
      branchMaxima.push(this.scanBranch())
      if (this.index === this.characters.length) break
      this.index += 1
      if (branchMaxima.length >= MAX_ALTERNATIVES) {
        invalid('portable pattern has too many alternatives')
      }
    }
    return Math.max(...branchMaxima)
  }

  private scanBranch(): number {
    let atomCount = 0
    let quantifiedCount = 0
    let maximumLength = 0
    let previousQuantified = false
    let previousCharacters: AcceptedCharacters | null = null

    while (
      this.index < this.characters.length &&
      this.characters[this.index] !== '|'
    ) {
      const characters = this.scanAtom()
      atomCount += 1
      if (atomCount > MAX_ATOMS_PER_ALTERNATIVE) {
        invalid('portable pattern branch has too many atoms')
      }

      const [maximumRepetition, quantified] = this.scanQuantifier()
      if (quantified) {
        quantifiedCount += 1
        if (quantifiedCount > MAX_QUANTIFIED_ATOMS_PER_ALTERNATIVE) {
          invalid('portable pattern branch has too many quantified atoms')
        }
        if (
          previousQuantified &&
          previousCharacters !== null &&
          overlaps(previousCharacters, characters)
        ) {
          invalid('adjacent quantified atoms accept overlapping characters')
        }
      }

      maximumLength += maximumRepetition
      if (maximumLength > MAX_BRANCH_MATCH_LENGTH) {
        invalid('portable pattern branch maximum length is too large')
      }
      previousQuantified = quantified
      previousCharacters = characters
    }

    if (atomCount === 0) invalid('portable pattern alternatives cannot be empty')
    return maximumLength
  }

  private scanAtom(): AcceptedCharacters {
    const character = this.characters[this.index]
    if (character === undefined) invalid('portable pattern atom is missing')
    if (character === '.') {
      this.index += 1
      return ANY_CHARACTER
    }
    if (character === '[') return this.scanCharacterClass()
    if (character === '\\') {
      const literal = this.scanEscape()
      const codePoint = requireCodePoint(literal)
      return { intervals: [[codePoint, codePoint]], matchesAny: false }
    }
    if (FORBIDDEN_UNESCAPED.has(character)) {
      invalid(`unescaped metacharacter ${JSON.stringify(character)} is not portable`)
    }

    this.index += 1
    const codePoint = requireCodePoint(character)
    return { intervals: [[codePoint, codePoint]], matchesAny: false }
  }

  private scanEscape(): string {
    this.index += 1
    if (this.index === this.characters.length) {
      invalid('portable pattern ends with an incomplete escape')
    }
    const escaped = this.characters[this.index]
    if (escaped === undefined || !ESCAPABLE_METACHARACTERS.has(escaped)) {
      invalid('only literal metacharacters may be escaped')
    }
    this.index += 1
    return escaped
  }

  private scanCharacterClass(): AcceptedCharacters {
    this.index += 1
    const items: Array<readonly [string, boolean]> = []
    while (
      this.index < this.characters.length &&
      this.characters[this.index] !== ']'
    ) {
      const character = this.characters[this.index]
      if (character === '\\') {
        items.push([this.scanEscape(), true])
        continue
      }
      if (character === '[' || (character === '^' && items.length === 0)) {
        invalid('nested or negated character classes are not portable')
      }
      if (character === undefined) invalid('portable character class item is missing')
      items.push([character, false])
      this.index += 1
    }

    if (this.index === this.characters.length) {
      invalid('portable character class is not closed')
    }
    this.index += 1
    if (items.length === 0) invalid('portable character classes cannot be empty')

    const intervals: Array<readonly [number, number]> = []
    let itemIndex = 0
    while (itemIndex < items.length) {
      const item = items[itemIndex]
      if (item === undefined) invalid('portable character class item is missing')
      const [character, escaped] = item
      const separator = items[itemIndex + 1]
      const rangeEnd = items[itemIndex + 2]
      if (
        rangeEnd !== undefined &&
        separator?.[0] === '-' &&
        separator[1] === false &&
        character !== '-'
      ) {
        const end = rangeEnd[0]
        const startPoint = requireCodePoint(character)
        const endPoint = requireCodePoint(end)
        if (end === '-' || startPoint > endPoint) {
          invalid('portable character class contains a descending range')
        }
        intervals.push([startPoint, endPoint])
        itemIndex += 3
        continue
      }
      if (
        character === '-' &&
        !escaped &&
        itemIndex !== 0 &&
        itemIndex !== items.length - 1
      ) {
        invalid('portable character class contains a malformed range')
      }
      const codePoint = requireCodePoint(character)
      intervals.push([codePoint, codePoint])
      itemIndex += 1
    }
    return { intervals, matchesAny: false }
  }

  private scanQuantifier(): readonly [number, boolean] {
    if (this.index === this.characters.length) return [1, false]
    if (this.characters[this.index] === '?') {
      this.index += 1
      return [1, true]
    }
    if (this.characters[this.index] !== '{') return [1, false]

    const closing = this.characters.indexOf('}', this.index + 1)
    if (closing === -1) invalid('portable repetition is not closed')
    const body = this.characters.slice(this.index + 1, closing).join('')
    const parts = body.split(',')
    let lower: number
    let upper: number
    if (parts.length === 1 && isAsciiDigits(parts[0] ?? '')) {
      lower = parseBound(parts[0] ?? '')
      upper = lower
    } else if (
      parts.length === 2 &&
      isAsciiDigits(parts[0] ?? '') &&
      isAsciiDigits(parts[1] ?? '')
    ) {
      lower = parseBound(parts[0] ?? '')
      upper = parseBound(parts[1] ?? '')
    } else {
      invalid('portable repetition must be {m} or {m,n}')
    }
    if (lower > upper) invalid('portable repetition bounds are descending')
    if (upper > MAX_REPETITION) invalid('portable repetition upper bound is too large')
    this.index = closing + 1
    return [upper, true]
  }
}

export function compilePortablePattern(source: string): PortablePattern {
  const sourceCharacters = [...source]
  if (sourceCharacters.length === 0) invalid('portable pattern cannot be empty')
  if (sourceCharacters.length > MAX_PATTERN_LENGTH) {
    invalid('portable pattern source is too long')
  }

  const maxMatchLength = new PatternScanner(source).scan()
  let compiled: RegExp
  try {
    // Unicode mode makes one dot/class atom consume one code point, matching Python. JavaScript's
    // Unicode grammar rejects an escaped hyphen outside classes, so normalize only that already
    // validated literal spelling before compilation.
    compiled = new RegExp(`^(?:${unicodeRegexSource(source)})$`, 'u')
  } catch {
    invalid('portable pattern could not be compiled')
  }

  return Object.freeze({
    source,
    maxMatchLength,
    matches(value: string): boolean {
      if ([...value].length > maxMatchLength) return false
      const match = compiled.exec(value)
      return match !== null && match[0].length === value.length
    },
  })
}

function overlaps(left: AcceptedCharacters, right: AcceptedCharacters): boolean {
  if (left.matchesAny || right.matchesAny) return true
  return left.intervals.some(([leftStart, leftEnd]) =>
    right.intervals.some(
      ([rightStart, rightEnd]) => leftStart <= rightEnd && rightStart <= leftEnd,
    ),
  )
}

function unicodeRegexSource(source: string): string {
  const characters = [...source]
  let inClass = false
  let normalized = ''
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]
    if (character === '\\') {
      const escaped = characters[index + 1]
      if (escaped === undefined) return source
      normalized += escaped === '-' && !inClass ? String.raw`\x2D` : `\\${escaped}`
      index += 1
      continue
    }
    if (character === '[') inClass = true
    if (character === ']') inClass = false
    // Python dot excludes LF only; JavaScript dot additionally excludes CR/U+2028/U+2029.
    normalized += character === '.' && !inClass ? String.raw`[^\n]` : character
  }
  return normalized
}

function isAsciiDigits(value: string): boolean {
  return value.length > 0 && [...value].every((character) => character >= '0' && character <= '9')
}

function parseBound(value: string): number {
  let result = 0
  for (const character of value) {
    result = result * 10 + (character.codePointAt(0) ?? 48) - 48
    if (result > MAX_REPETITION) return result
  }
  return result
}

function requireCodePoint(character: string): number {
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) invalid('portable pattern character is missing')
  return codePoint
}

function invalid(diagnostic: string): never {
  throw new PortablePatternError(diagnostic)
}
