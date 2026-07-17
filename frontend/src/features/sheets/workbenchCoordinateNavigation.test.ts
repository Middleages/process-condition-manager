import { describe, expect, it } from 'vitest'

import { resolveWorkbenchCoordinateNavigation } from './workbenchCoordinateNavigation'

const columns = [
  { key: 'amount', categoryCode: 'process' },
  { key: 'equipment', categoryCode: 'equipment' },
]

const rows = [{ id: '11' }, { id: '12' }]

describe('shared workbench coordinate navigation', () => {
  it('returns direct, reveal-category, and missing-target outcomes for shared coordinates', () => {
    expect(
      resolveWorkbenchCoordinateNavigation(
        { conditionId: '11', parameterCode: 'amount' },
        columns,
        rows,
        'process',
      ),
    ).toEqual({
      kind: 'direct',
      target: { conditionId: '11', parameterCode: 'amount' },
    })

    expect(
      resolveWorkbenchCoordinateNavigation(
        { conditionId: '11', parameterCode: 'equipment' },
        columns,
        rows,
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
        columns,
        rows,
        null,
      ),
    ).toEqual({ kind: 'missing-target' })
  })
})
