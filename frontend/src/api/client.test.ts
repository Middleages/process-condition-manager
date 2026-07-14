import { describe, expect, it } from 'vitest'

import {
  getApiErrorStatus,
  getChoiceSetChangedDetails,
  getChoiceSetChangedSummary,
  getExistingProjectId,
  getLockConflictHolder,
  isChoiceSetChanged,
  isLockConflict,
} from './client'

function makeAxiosError(status: number, data: unknown) {
  return { isAxiosError: true, response: { status, data } }
}

describe('409 error classification', () => {
  it('does not classify every 409 as a lock conflict', () => {
    const changed = makeAxiosError(409, { code: 'choice_set_changed', message: 'changed' })
    const locked = makeAxiosError(409, { code: 'lock_conflict', message: 'locked' })

    expect(isLockConflict(changed)).toBe(false)
    expect(isChoiceSetChanged(changed)).toBe(true)
    expect(isLockConflict(locked)).toBe(true)
  })

  it('returns only object details for a choice set change', () => {
    const details = { current_choice_set_id: 42 }

    expect(
      getChoiceSetChangedDetails(
        makeAxiosError(409, {
          code: 'choice_set_changed',
          message: 'changed',
          details,
        }),
      ),
    ).toBe(details)
    expect(
      getChoiceSetChangedDetails(
        makeAxiosError(409, {
          code: 'choice_set_changed',
          message: 'changed',
          details: 'not-an-object',
        }),
      ),
    ).toBeNull()
  })

  it('returns a structurally valid current choice-set summary', () => {
    const choiceSet = {
      code: 'equipment_mode',
      display_name: 'Equipment mode',
      description: null,
      is_active: true,
      version: 4,
      option_count: 2,
      active_option_count: 1,
      parameter_usage_count: 3,
      profile_usage_fields: ['foundry'],
      created_at: '2026-07-14T00:00:00Z',
      updated_at: '2026-07-14T00:01:00Z',
    }

    expect(
      getChoiceSetChangedSummary(
        makeAxiosError(409, {
          code: 'choice_set_changed',
          message: 'changed',
          details: { actual_version: 4, choice_set: choiceSet },
        }),
      ),
    ).toBe(choiceSet)
  })

  it.each([
    undefined,
    null,
    [],
    { code: 'equipment_mode' },
    {
      code: 'equipment_mode',
      display_name: 'Equipment mode',
      description: null,
      is_active: true,
      version: '4',
      option_count: 2,
      active_option_count: 1,
      parameter_usage_count: 3,
      profile_usage_fields: ['foundry'],
      created_at: '2026-07-14T00:00:00Z',
      updated_at: '2026-07-14T00:01:00Z',
    },
  ])('returns null for malformed choice-set summary %j', (choiceSet) => {
    expect(
      getChoiceSetChangedSummary(
        makeAxiosError(409, {
          code: 'choice_set_changed',
          message: 'changed',
          details: { actual_version: 4, choice_set: choiceSet },
        }),
      ),
    ).toBeNull()
  })
})

describe('getLockConflictHolder', () => {
  it('reads the current editor from a lock conflict response', () => {
    expect(
      getLockConflictHolder({
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            code: 'lock_conflict',
            message: 'already locked',
            details: { locked_by: 'someone-else' },
          },
        },
      }),
    ).toBe('someone-else')
  })

  it('returns null for malformed or unrelated errors', () => {
    expect(getLockConflictHolder(new Error('offline'))).toBeNull()
    expect(
      getLockConflictHolder({
        isAxiosError: true,
        response: { status: 409, data: { code: 'lock_conflict', message: 'busy', details: {} } },
      }),
    ).toBeNull()
  })
})

describe('getExistingProjectId', () => {
  function duplicateError(existingProjectId?: unknown) {
    return {
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          code: 'conflict',
          message: 'already exists',
          details:
            existingProjectId === undefined
              ? {}
              : { existing_project_id: existingProjectId },
        },
      },
    }
  }

  it('reads a positive numeric existing project ID', () => {
    expect(getExistingProjectId(duplicateError(42))).toBe(42)
  })

  it.each([undefined, '42', 0, -3, 1.5])(
    'returns null for malformed existing project ID %s',
    (existingProjectId) => {
      expect(getExistingProjectId(duplicateError(existingProjectId))).toBeNull()
    },
  )

  it('returns null for non-409 errors', () => {
    expect(getExistingProjectId(new Error('offline'))).toBeNull()
    expect(
      getExistingProjectId({
        isAxiosError: true,
        response: {
          status: 404,
          data: {
            code: 'not_found',
            message: 'missing',
            details: { existing_project_id: 42 },
          },
        },
      }),
    ).toBeNull()
  })

  it('keeps status inspection separate from malformed response details', () => {
    expect(getApiErrorStatus(duplicateError('not-an-id'))).toBe(409)
    expect(getApiErrorStatus(new Error('offline'))).toBeNull()
  })
})
