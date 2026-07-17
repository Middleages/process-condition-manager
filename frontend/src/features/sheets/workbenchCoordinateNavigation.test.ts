import { describe, expect, it } from 'vitest'

import type { ConditionGridColumn, ConditionGridRow } from '@/grid/types'

import { resolveWorkbenchCoordinateNavigation } from './workbenchCoordinateNavigation'

const columns = [
  { key: 'amount', categoryCode: 'process' },
  { key: 'equipment', categoryCode: 'equipment' },
] as const

const rows = [{ id: '11' }, { id: '12' }] as const

const navigationColumns = columns as unknown as readonly ConditionGridColumn[]
const navigationRows = rows as unknown as readonly ConditionGridRow[]

describe('shared workbench coordinate navigation', () => {
  it('returns direct, reveal-category, and missing-target outcomes for shared coordinates', () => {
    expect(
      resolveWorkbenchCoordinateNavigation(
        { conditionId: '11', parameterCode: 'amount' },
        navigationColumns,
        navigationRows,
        'process',
      ),
    ).toEqual({
      kind: 'direct',
      target: { conditionId: '11', parameterCode: 'amount' },
    })

    expect(
      resolveWorkbenchCoordinateNavigation(
        { conditionId: '11', parameterCode: 'equipment' },
        navigationColumns,
        navigationRows,
        'process',
      ),
    ).toEqual({
      kind: 'reveal-category',
      categoryCode: 'equipment',
      target: { conditionId: '11', parameterCode: 'equipment' },
    })

    expect(
      resolveWorkbenchCoordinateNavigation(
        { conditionId: '999', parameterCode: 'equipment' },
        navigationColumns,
        navigationRows,
        null,
      ),
    ).toEqual({ kind: 'missing-target' })
  })
})
