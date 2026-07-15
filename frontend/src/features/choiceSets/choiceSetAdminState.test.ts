import { describe, expect, it, vi } from 'vitest'

import type { ChoiceImportPreviewOut, ChoiceOptionOut } from '@/api/types'

import {
  CHOICE_CODE_HELP,
  canApplyChoicePreview,
  completeChoiceSetMutation,
  filterChoiceOptions,
  findCaseOnlyCodeCollision,
  isCurrentChoicePreview,
  isUrlSafeChoiceCode,
  isExactChoiceSetAdminSnapshot,
  loadExactChoiceSetAdminSnapshot,
  moveOption,
  getObservedChoiceSetConflict,
  isChoiceSetOwnerCurrent,
  resetChoiceMutationErrors,
  toOrderPayload,
} from './choiceSetAdminState'
import type { ChoiceSetSummaryOut } from '@/api/types'

const allOptions: ChoiceOptionOut[] = [
  { code: 'A', label: 'Alpha', sort_order: 10, is_active: true },
  { code: 'B', label: 'Beta', sort_order: 20, is_active: false },
  { code: 'C', label: 'Gamma', sort_order: 30, is_active: true },
]

const response: ChoiceImportPreviewOut = {
  set_code: 'mode',
  base_version: 3,
  created_count: 1,
  updated_count: 0,
  error_count: 0,
  rows: [{ line: 2, code: 'A', action: 'create', message: null }],
}

describe('choice-set administration state', () => {
  it('moves a visible unfiltered row but sends every code once', () => {
    const moved = moveOption(allOptions, 'B', -1)
    expect(moved.map((option) => option.code)).toEqual(['B', 'A', 'C'])
    expect(toOrderPayload(7, moved)).toEqual({
      expected_version: 7,
      ordered_codes: ['B', 'A', 'C'],
    })
  })

  it('authorizes admin writes only from an exact complete inactive-inclusive aggregate', () => {
    const summary: ChoiceSetSummaryOut = {
      code: 'mode',
      display_name: 'Mode',
      description: null,
      is_active: true,
      version: 7,
      option_count: 3,
      active_option_count: 2,
      parameter_usage_count: 0,
      profile_usage_fields: [],
      created_at: '2026-07-14T00:00:00Z',
      updated_at: '2026-07-14T00:00:00Z',
    }
    const aggregate = { set_code: 'mode', version: 7, items: allOptions }

    expect(isExactChoiceSetAdminSnapshot(summary, aggregate, true)).toBe(true)
    expect(isExactChoiceSetAdminSnapshot(summary, { ...aggregate, version: 8 }, true)).toBe(false)
    expect(isExactChoiceSetAdminSnapshot(summary, { ...aggregate, set_code: 'other' }, true)).toBe(false)
    expect(isExactChoiceSetAdminSnapshot(summary, aggregate, false)).toBe(false)
  })

  it('rejects an aggregate whose active lifecycle checksum disagrees with the summary', () => {
    const summary: ChoiceSetSummaryOut = {
      code: 'mode',
      display_name: 'Mode',
      description: null,
      is_active: true,
      version: 7,
      option_count: 3,
      active_option_count: 1,
      parameter_usage_count: 0,
      profile_usage_fields: [],
      created_at: '2026-07-14T00:00:00Z',
      updated_at: '2026-07-14T00:00:00Z',
    }

    expect(
      isExactChoiceSetAdminSnapshot(
        summary,
        { set_code: 'mode', version: 7, items: allOptions },
        true,
      ),
    ).toBe(false)
  })

  it('fails an owned write closed as soon as another summary version is observed', () => {
    const observed: ChoiceSetSummaryOut = {
      code: 'mode',
      display_name: 'Mode',
      description: null,
      is_active: true,
      version: 8,
      option_count: 3,
      active_option_count: 2,
      parameter_usage_count: 0,
      profile_usage_fields: [],
      created_at: '2026-07-14T00:00:00Z',
      updated_at: '2026-07-14T00:00:00Z',
    }
    const observedSnapshot = {
      summary: observed,
      aggregate: { set_code: 'mode', version: 8, items: allOptions },
    }

    expect(isChoiceSetOwnerCurrent('mode', 7, observedSnapshot)).toBe(false)
    expect(getObservedChoiceSetConflict('mode', 7, observed)).toBe(observed)
    expect(isChoiceSetOwnerCurrent('mode', 8, observedSnapshot)).toBe(true)
    expect(getObservedChoiceSetConflict('other', 7, observed)).toBeNull()
    expect(isChoiceSetOwnerCurrent('mode', 8, null)).toBe(false)
    expect(
      isChoiceSetOwnerCurrent('mode', 8, {
        summary: { ...observed, active_option_count: 1 },
        aggregate: observedSnapshot.aggregate,
      }),
    ).toBe(false)
  })

  it('restarts a mismatched admin snapshot and returns only an exact complete pair', async () => {
    const summary7: ChoiceSetSummaryOut = {
      code: 'mode',
      display_name: 'Mode',
      description: null,
      is_active: true,
      version: 7,
      option_count: 3,
      active_option_count: 2,
      parameter_usage_count: 0,
      profile_usage_fields: [],
      created_at: '2026-07-14T00:00:00Z',
      updated_at: '2026-07-14T00:00:00Z',
    }
    const summary8 = { ...summary7, version: 8 }
    const loadSummary = vi.fn().mockResolvedValueOnce(summary7).mockResolvedValueOnce(summary8)
    const loadAggregate = vi
      .fn()
      .mockResolvedValueOnce({ set_code: 'mode', version: 8, items: allOptions })
      .mockResolvedValueOnce({ set_code: 'mode', version: 8, items: allOptions })

    await expect(
      loadExactChoiceSetAdminSnapshot('mode', { loadSummary, loadAggregate }),
    ).resolves.toEqual({ summary: summary8, aggregate: { set_code: 'mode', version: 8, items: allOptions } })
    expect(loadSummary).toHaveBeenCalledTimes(2)
    expect(loadAggregate).toHaveBeenNthCalledWith(1, 'mode', 7, true)
    expect(loadAggregate).toHaveBeenNthCalledWith(2, 'mode', 8, true)
  })

  it('closes an editor only after cache invalidation has completed', async () => {
    let release: () => void = () => undefined
    const invalidate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const close = vi.fn()

    const completion = completeChoiceSetMutation(invalidate, close)
    await Promise.resolve()
    expect(close).not.toHaveBeenCalled()

    release()
    await completion
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('clears stale mutation errors before an explicit reload hydrates state', () => {
    const resetWrite = vi.fn()
    const resetPreview = vi.fn()

    resetChoiceMutationErrors(resetWrite, resetPreview)

    expect(resetWrite).toHaveBeenCalledTimes(1)
    expect(resetPreview).toHaveBeenCalledTimes(1)
  })

  it('keeps inactive options available to local detail filtering', () => {
    expect(filterChoiceOptions(allOptions, { query: '', active: 'all' })).toEqual(
      allOptions,
    )
    expect(
      filterChoiceOptions(allOptions, { query: 'bet', active: 'inactive' }).map(
        ({ code }) => code,
      ),
    ).toEqual(['B'])
  })

  it('invalidates preview when csv text or base version changes', () => {
    const preview = { csvText: 'A,Alpha,1,true', baseVersion: 3, response }
    expect(isCurrentChoicePreview(preview, preview.csvText, 3)).toBe(true)
    expect(isCurrentChoicePreview(preview, preview.csvText, 4)).toBe(false)
    expect(isCurrentChoicePreview(preview, 'B,Beta,1,true', 3)).toBe(false)
    expect(canApplyChoicePreview(preview, preview.csvText, 3)).toBe(true)
    expect(
      canApplyChoicePreview(
        { ...preview, response: { ...response, error_count: 1 } },
        preview.csvText,
        3,
      ),
    ).toBe(false)
  })

  it('finds only case-only collisions and preserves exact-case identity', () => {
    expect(findCaseOnlyCodeCollision(allOptions, 'a')).toBe('A')
    expect(findCaseOnlyCodeCollision(allOptions, 'A')).toBeNull()
    expect(findCaseOnlyCodeCollision(allOptions, 'BAR')).toBeNull()
  })

  it.each([
    ['A.B-_1', true],
    ['A/B', false],
    ['A%2FB', false],
    ['A B', false],
    ['선택', false],
    ['.', false],
    ['..', false],
    ['', false],
  ])('validates the shared URL-safe code grammar for %s', (code, valid) => {
    expect(isUrlSafeChoiceCode(code)).toBe(valid)
    expect(CHOICE_CODE_HELP).toContain('URL-safe')
  })
})
