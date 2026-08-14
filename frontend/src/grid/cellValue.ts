import type { ChoiceOptionAggregate, ChoiceOptionOut } from '@/api/types'
import { compareCanonicalDecimals, normalizeDecimalInput } from '@/shared/domain/decimal'

import type {
  CellValidationErrorCode,
  ConditionGridColumn,
  SheetChoiceResource,
} from './types'

export type CellCandidateResult =
  | { ok: true; value: string | null }
  | {
      ok: false
      code: CellValidationErrorCode
      message: string
      constraint: string | null
      rawValue: string
    }

export type CellChoiceValidationContext = Pick<
  SheetChoiceResource,
  | 'setCode'
  | 'targetVersion'
  | 'summaryVersion'
  | 'setIsActive'
  | 'displayAggregate'
  | 'selectableAggregate'
  | 'selectionReady'
  | 'isStale'
>

/** 정규화 뒤 값이 같으면 backend에 no-op update를 보내지 않는다. */
export function shouldPersistCellChange(
  oldValue: string | null,
  nextValue: string | null,
): boolean {
  return oldValue !== nextValue
}

const optionIndexes = new WeakMap<
  ChoiceOptionAggregate,
  ReadonlyMap<string, ChoiceOptionOut>
>()

/** Aggregate별로 한 번만 생성하는 code index. 셀 렌더와 검증에서 공유한다. */
export function optionIndexForAggregate(
  aggregate: ChoiceOptionAggregate,
): ReadonlyMap<string, ChoiceOptionOut> {
  const cached = optionIndexes.get(aggregate)
  if (cached !== undefined) return cached
  const index = new Map<string, ChoiceOptionOut>()
  for (const option of aggregate.items) index.set(option.code, option)
  optionIndexes.set(aggregate, index)
  return index
}

export function validateCellCandidate(
  column: ConditionGridColumn,
  oldValue: string | null,
  raw: string,
  context?: CellChoiceValidationContext,
): CellCandidateResult {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return column.required
      ? failure('required_value', '필수값을 입력하세요', raw, null)
      : { ok: true, value: null }
  }

  if (column.valueType === 'text') return { ok: true, value: trimmed }

  if (column.valueType === 'number') {
    const normalized = normalizeDecimalInput(raw)
    if (normalized.kind === 'empty') return { ok: true, value: null }
    if (normalized.kind !== 'valid') return failure('invalid_decimal', '숫자로 입력하세요', raw)
    if (!decimalWithinBounds(normalized.value, column.minValue, column.maxValue)) {
      return failure(
        'number_out_of_range',
        '허용 범위를 벗어났습니다',
        raw,
        numericConstraint(column),
      )
    }
    return { ok: true, value: normalized.value }
  }

  const isUnchanged = trimmed === oldValue
  const knownAggregate = exactKnownAggregate(column, context)

  if (isUnchanged) {
    // 조회 불가/오래된 display fallback일 때만 저장된 raw를 보존한다. 활성 여부와 무관하게
    // 정확한 집합이 있으면 backend처럼 실제 option 존재를 확인해야 unknown no-op를 막는다.
    if (knownAggregate === null) return { ok: true, value: oldValue }
    if (!optionIndexForAggregate(knownAggregate).has(trimmed)) {
      return failure('choice_unknown', '현재 선택지에 없는 코드입니다.', raw, choiceConstraint)
    }
    return { ok: true, value: oldValue }
  }
  if (context?.setIsActive === false) {
    return failure(
      'choice_set_inactive',
      '사용 중지된 선택지 집합에서는 새 값을 선택할 수 없습니다.',
      raw,
      choiceConstraint,
    )
  }
  if (
    context === undefined ||
    context.setIsActive !== true ||
    !context.selectionReady ||
    context.selectableAggregate === null
  ) {
    return failure(
      'choice_resource_unavailable',
      '최신 선택지를 확인한 뒤 다시 선택해 주세요.',
      raw,
    )
  }

  const option = optionIndexForAggregate(context.selectableAggregate).get(trimmed)
  if (option === undefined) {
    return failure('choice_unknown', '현재 선택지에 없는 코드입니다.', raw, choiceConstraint)
  }
  if (!option.is_active) {
    return failure(
      'choice_option_inactive',
      '사용 중지된 선택지는 새 값으로 저장할 수 없습니다.',
      raw,
      choiceConstraint,
    )
  }
  return { ok: true, value: option.code }
}

/** 단일 편집과 붙여넣기가 같은 규칙을 호출하는 명시적 경계. */
export const validateSingleCellEdit = validateCellCandidate
export const validatePasteCell = validateCellCandidate

/** 선택 가능성과 분리된 exact knownness: inactive set도 기존 known code no-op은 허용한다. */
function exactKnownAggregate(
  column: ConditionGridColumn,
  context: CellChoiceValidationContext | undefined,
): ChoiceOptionAggregate | null {
  if (
    context === undefined ||
    context.isStale ||
    context.setCode !== column.choiceSetCode ||
    context.summaryVersion === null ||
    context.summaryVersion !== context.targetVersion
  ) {
    return null
  }
  const aggregate = context.displayAggregate
  return aggregate?.set_code === context.setCode && aggregate.version === context.targetVersion
    ? aggregate
    : null
}

function failure(
  code: CellValidationErrorCode,
  message: string,
  rawValue: string,
  constraint: string | null = null,
): CellCandidateResult {
  return { ok: false, code, message, constraint, rawValue }
}

const choiceConstraint = '목록에서 사용할 수 있는 값을 선택하세요'

function decimalWithinBounds(
  value: string,
  minValue: string | null,
  maxValue: string | null,
): boolean {
  return (
    (minValue === null || compareCanonicalDecimals(value, minValue) >= 0) &&
    (maxValue === null || compareCanonicalDecimals(value, maxValue) <= 0)
  )
}

function numericConstraint(column: ConditionGridColumn): string | null {
  const unit = column.unit === null || column.unit === undefined || column.unit === '' ? '' : ` ${column.unit}`
  if (column.minValue !== null && column.maxValue !== null) {
    return `${column.minValue}–${column.maxValue}${unit} 범위로 입력하세요`
  }
  if (column.minValue !== null) return `${column.minValue}${unit} 이상으로 입력하세요`
  if (column.maxValue !== null) return `${column.maxValue}${unit} 이하로 입력하세요`
  return null
}
