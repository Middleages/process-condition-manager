import { describe, expect, it } from 'vitest'
import type { ConditionGridRow } from '../../grid/types'
import {
  firstConditionIdForLayer,
  recoverLayerSelection,
  rowsForLayerViewport,
} from './layerViewportState'

const rows: ConditionGridRow[] = [
  { id: '1', layerKey: 'L1', stepSeq: '001', layerId: 'L-01', layerLabel: 'L-01 (001)', conditionLabel: 'A', isPor: false, values: {} },
  { id: '2', layerKey: 'L1', stepSeq: '001', layerId: 'L-01', layerLabel: 'L-01 (001)', conditionLabel: 'B', isPor: false, values: {} },
  { id: '3', layerKey: 'L2', stepSeq: '002', layerId: 'L-02', layerLabel: 'L-02 (002)', conditionLabel: 'C', isPor: false, values: {} },
  { id: '4', layerKey: 'L3', stepSeq: '003', layerId: 'L-03', layerLabel: 'L-03 (003)', conditionLabel: 'D', isPor: false, values: {} },
]

describe('layerViewportState', () => {
  it('returns every row when the current-layer focus is off', () => {
    expect(rowsForLayerViewport(rows, 'L2', false)).toEqual(rows)
  })

  it('returns only the active Layer rows when the current-layer focus is on', () => {
    expect(rowsForLayerViewport(rows, 'L2', true).map((row) => row.layerKey)).toEqual(['L2'])
  })

  it('finds the first condition for a Layer', () => {
    expect(firstConditionIdForLayer(rows, 'L2')).toBe('3')
  })

  it('recovers to the next Layer with a row when the previous Layer disappears', () => {
    const rowsWithoutL2 = rows.filter((row) => row.layerKey !== 'L2')

    expect(recoverLayerSelection(rowsWithoutL2, ['L1', 'L2', 'L3'], 'L2')).toEqual({
      layerKey: 'L3',
      conditionId: '4',
    })
  })

  it('does not recover a selection without any rows', () => {
    expect(recoverLayerSelection([], ['L1', 'L2'], 'L2')).toBeNull()
  })

  it('does not recover a selection for a Layer outside the original order', () => {
    expect(recoverLayerSelection(rows, ['L1', 'L2', 'L3'], 'unknown')).toBeNull()
  })
})
