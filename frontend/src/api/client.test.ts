import { describe, expect, it } from 'vitest'

import { getLockConflictHolder } from './client'

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
