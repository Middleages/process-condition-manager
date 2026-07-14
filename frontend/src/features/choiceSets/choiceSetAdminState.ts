import type {
  ChoiceImportPreviewOut,
  ChoiceOptionAggregate,
  ChoiceOptionOrderIn,
  ChoiceOptionOut,
  ChoiceSetSummaryOut,
} from '@/api/types'

import type { ChoiceSetSearchState } from './choiceSetUrlState'

const CHOICE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const CHOICE_CODE_HELP =
  'URL-safe ASCII 코드만 사용할 수 있습니다. 영문자 또는 숫자로 시작하고 영문자, 숫자, 점(.), 하이픈(-), 밑줄(_)만 입력하세요. 단독 . 또는 ..은 사용할 수 없습니다.'

export interface ChoicePreviewSnapshot {
  csvText: string
  baseVersion: number
  response: ChoiceImportPreviewOut
}

export function isExactChoiceSetAdminSnapshot(
  summary: ChoiceSetSummaryOut,
  aggregate: ChoiceOptionAggregate,
  includeInactive: boolean,
): boolean {
  return (
    includeInactive &&
    aggregate.set_code === summary.code &&
    aggregate.version === summary.version &&
    aggregate.items.length === summary.option_count &&
    aggregate.items.filter((option) => option.is_active).length ===
      summary.active_option_count
  )
}

export interface ChoiceSetAdminSnapshot {
  summary: ChoiceSetSummaryOut
  aggregate: ChoiceOptionAggregate
}

export function isChoiceSetOwnerCurrent(
  ownerCode: string,
  ownerVersion: number,
  observedSnapshot: ChoiceSetAdminSnapshot | null,
): boolean {
  return (
    observedSnapshot !== null &&
    isExactChoiceSetAdminSnapshot(
      observedSnapshot.summary,
      observedSnapshot.aggregate,
      true,
    ) &&
    observedSnapshot.summary.code === ownerCode &&
    observedSnapshot.summary.version === ownerVersion
  )
}

export function getObservedChoiceSetConflict(
  ownerCode: string,
  ownerVersion: number,
  observedSummary: ChoiceSetSummaryOut | undefined,
): ChoiceSetSummaryOut | null {
  if (
    observedSummary?.code !== ownerCode ||
    observedSummary.version <= ownerVersion
  ) {
    return null
  }
  return observedSummary
}

export interface ChoiceSetAdminSnapshotLoaders {
  loadSummary: (setCode: string) => Promise<ChoiceSetSummaryOut>
  loadAggregate: (
    setCode: string,
    version: number,
    includeInactive: true,
  ) => Promise<ChoiceOptionAggregate>
}

export async function loadExactChoiceSetAdminSnapshot(
  setCode: string,
  loaders: ChoiceSetAdminSnapshotLoaders,
): Promise<ChoiceSetAdminSnapshot> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const summary = await loaders.loadSummary(setCode)
    const aggregate = await loaders.loadAggregate(setCode, summary.version, true)
    if (isExactChoiceSetAdminSnapshot(summary, aggregate, true)) {
      return { summary, aggregate }
    }
  }
  throw new Error(
    '선택지 집합의 전체 목록과 버전을 일치시키지 못했습니다. 다시 시도해 주세요.',
  )
}

export async function completeChoiceSetMutation(
  invalidate: () => Promise<void>,
  close: () => void,
): Promise<void> {
  await invalidate()
  close()
}

export function resetChoiceMutationErrors(
  ...resetters: Array<() => void>
): void {
  for (const reset of resetters) reset()
}

export function isUrlSafeChoiceCode(code: string): boolean {
  return (
    code !== '.' &&
    code !== '..' &&
    code.length > 0 &&
    CHOICE_CODE_PATTERN.test(code)
  )
}

export function findCaseOnlyCodeCollision(
  options: readonly ChoiceOptionOut[],
  draftCode: string,
): string | null {
  const normalized = draftCode.toLocaleLowerCase()
  const collision = options.find(
    (option) =>
      option.code !== draftCode && option.code.toLocaleLowerCase() === normalized,
  )
  return collision?.code ?? null
}

export function filterChoiceOptions(
  options: readonly ChoiceOptionOut[],
  state: ChoiceSetSearchState,
): ChoiceOptionOut[] {
  const query = state.query.trim().toLocaleLowerCase()
  return options.filter((option) => {
    const activityMatches =
      state.active === 'all' ||
      (state.active === 'active' ? option.is_active : !option.is_active)
    if (!activityMatches) return false
    return (
      query === '' ||
      option.code.toLocaleLowerCase().includes(query) ||
      option.label.toLocaleLowerCase().includes(query)
    )
  })
}

export function moveOption(
  options: readonly ChoiceOptionOut[],
  code: string,
  delta: -1 | 1,
): ChoiceOptionOut[] {
  const index = options.findIndex((option) => option.code === code)
  if (index < 0) return [...options]
  const nextIndex = Math.max(0, Math.min(options.length - 1, index + delta))
  if (nextIndex === index) return [...options]

  const moved = [...options]
  const [option] = moved.splice(index, 1)
  if (option) moved.splice(nextIndex, 0, option)
  return moved
}

export function toOrderPayload(
  expectedVersion: number,
  options: readonly ChoiceOptionOut[],
): ChoiceOptionOrderIn {
  return {
    expected_version: expectedVersion,
    ordered_codes: options.map((option) => option.code),
  }
}

export function isCurrentChoicePreview(
  preview: Pick<ChoicePreviewSnapshot, 'csvText' | 'baseVersion'> | null,
  csvText: string,
  currentVersion: number,
): boolean {
  return (
    preview !== null &&
    preview.csvText === csvText &&
    preview.baseVersion === currentVersion
  )
}

export function canApplyChoicePreview(
  preview: ChoicePreviewSnapshot | null,
  csvText: string,
  currentVersion: number,
): boolean {
  return (
    isCurrentChoicePreview(preview, csvText, currentVersion) &&
    preview?.response.error_count === 0
  )
}
