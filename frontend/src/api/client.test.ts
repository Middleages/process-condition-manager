import { describe, expect, it } from 'vitest'

import {
  getApiErrorStatus,
  getChoiceSetChangedDetails,
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
