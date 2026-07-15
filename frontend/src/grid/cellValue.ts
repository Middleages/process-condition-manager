import type { ChoiceOptionAggregate, ChoiceOptionOut } from '@/api/types'
import { normalizeDecimalInput } from '@/shared/domain/decimal'

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
      rawValue: string
    }

export type CellChoiceValidationContext = Pick<
  SheetChoiceResource,
  'setIsActive' | 'selectionReady' | 'selectableAggregate'
>

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
  if (trimmed === '') return { ok: true, value: null }

  if (column.valueType === 'text') return { ok: true, value: trimmed }

  if (column.valueType === 'number') {
    const normalized = normalizeDecimalInput(raw)
    if (normalized.kind === 'empty') return { ok: true, value: null }
    if (normalized.kind === 'valid') return { ok: true, value: normalized.value }
    return failure('invalid_decimal', '올바른 소수 형식이 아닙니다.', raw)
  }

  // 이미 저장된 inactive/raw code는 값을 바꾸지 않는 no-op으로 보존한다.
  if (trimmed === oldValue) return { ok: true, value: oldValue }
  if (context?.setIsActive === false) {
    return failure(
      'choice_set_inactive',
      '사용 중지된 선택지 집합에서는 새 값을 선택할 수 없습니다.',
      raw,
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
    return failure('choice_unknown', '현재 선택지에 없는 코드입니다.', raw)
  }
  if (!option.is_active) {
    return failure(
      'choice_option_inactive',
      '사용 중지된 선택지는 새 값으로 저장할 수 없습니다.',
      raw,
    )
  }
  return { ok: true, value: option.code }
}

/** 단일 편집과 붙여넣기가 같은 규칙을 호출하는 명시적 경계. */
export const validateSingleCellEdit = validateCellCandidate
export const validatePasteCell = validateCellCandidate

function failure(
  code: CellValidationErrorCode,
  message: string,
  rawValue: string,
): CellCandidateResult {
  return { ok: false, code, message, rawValue }
}
