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
  it('returns direct outcomes when the target row and column stay visible', () => {
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
  })

  it('reveals the column category when the target is hidden behind a different active category', () => {
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
  })

  it('treats a null active category as directly reachable', () => {
    expect(
      resolveWorkbenchCoordinateNavigation(
        { conditionId: 11, parameterCode: 'amount' },
        navigationColumns,
        navigationRows,
        null,
      ),
    ).toEqual({
      kind: 'direct',
      target: { conditionId: '11', parameterCode: 'amount' },
    })
  })

  it('fails closed when the row or parameter target cannot be resolved', () => {
    expect(
      resolveWorkbenchCoordinateNavigation(
        { conditionId: '999', parameterCode: 'equipment' },
        navigationColumns,
        navigationRows,
        'process',
      ),
    ).toEqual({ kind: 'missing-target' })

    expect(
      resolveWorkbenchCoordinateNavigation(
        { conditionId: '11', parameterCode: 'missing' },
        navigationColumns,
        navigationRows,
        'process',
      ),
    ).toEqual({ kind: 'missing-target' })

    expect(
      resolveWorkbenchCoordinateNavigation(
        { conditionId: null, parameterCode: 'amount' },
        navigationColumns,
        navigationRows,
        'process',
      ),
    ).toEqual({ kind: 'missing-target' })

    expect(
      resolveWorkbenchCoordinateNavigation(
        { conditionId: '11', parameterCode: null },
        navigationColumns,
        navigationRows,
        'process',
      ),
    ).toEqual({ kind: 'missing-target' })
  })
})
