import { describe, expect, it } from 'vitest'

import { cellStatusVisualPriority } from './GlideConditionGrid'

describe('composite cell status rendering priority', () => {
  it('renders validation error above warning, dirty, and comment without requiring exclusive state', () => {
    expect(
      cellStatusVisualPriority({
        conditionId: '1',
        parameterCode: 'amount',
        validation: { severity: 'error', count: 2, message: 'invalid' },
        dirty: true,
        commentCount: 3,
      }),
    ).toBe('error')
    expect(
      cellStatusVisualPriority({
        conditionId: '1',
        parameterCode: 'amount',
        validation: { severity: 'warning', count: 1, message: 'review' },
        dirty: true,
        commentCount: 3,
      }),
    ).toBe('warning')
  })

  it('renders dirty above comment and preserves comment-only fallback', () => {
    expect(
      cellStatusVisualPriority({
        conditionId: '1',
        parameterCode: 'amount',
        dirty: true,
        commentCount: 1,
      }),
    ).toBe('dirty')
    expect(
      cellStatusVisualPriority({
        conditionId: '1',
        parameterCode: 'amount',
        dirty: false,
        commentCount: 1,
      }),
    ).toBe('comment')
  })
})
