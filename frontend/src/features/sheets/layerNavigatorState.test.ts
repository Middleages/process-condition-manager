import { describe, expect, it } from 'vitest'
import type { ProjectLayerOut } from '../../api/types'
import {
  buildLayerNavigatorItems,
  filterLayerNavigatorItems,
  resolveLayerNavigatorIndex,
  updateRecentLayerKeys,
} from './layerNavigatorState'

function layer(index: number): ProjectLayerOut {
  return {
    id: index,
    layer_key: `layer-${index}`,
    step_seq: `S${String(index).padStart(3, '0')}`,
    layer_id: `L${index}`,
    eqp_type: 'ETCH',
    eqp_type_desc: index === 8 ? '식각 메인' : `장비 ${index}`,
    area_name: 'FAB',
    sort_order: 101 - index,
    condition_count: 2,
    cell_count: 4,
    source_project_id: null,
    source_layer_key: null,
  }
}

describe('layerNavigatorState', () => {
  it('sorts and numbers 100 layers while decorating issue and dirty state', () => {
    const layers = Array.from({ length: 100 }, (_, index) => layer(index + 1))
    const items = buildLayerNavigatorItems(
      layers,
      new Map([['layer-100', 4]]),
      new Set(['layer-100']),
    )

    expect(items).toHaveLength(100)
    expect(items[0]).toMatchObject({ key: 'layer-100', number: '01', errorCount: 4, dirty: true })
    expect(items[99]).toMatchObject({ key: 'layer-1', number: '100' })
  })

  it('searches Korean descriptions, layer ids, step sequences, and keys', () => {
    const items = buildLayerNavigatorItems([layer(8), layer(9)], new Map(), new Set())
    expect(filterLayerNavigatorItems(items, '식각')).toHaveLength(1)
    expect(filterLayerNavigatorItems(items, 'L9')[0]?.key).toBe('layer-9')
    expect(filterLayerNavigatorItems(items, 's008')[0]?.key).toBe('layer-8')
    expect(filterLayerNavigatorItems(items, 'layer-9')[0]?.key).toBe('layer-9')
  })

  it('keeps three unique recent layers with the newest first', () => {
    expect(updateRecentLayerKeys(['b', 'a', 'c'], 'a')).toEqual(['a', 'b', 'c'])
    expect(updateRecentLayerKeys(['c', 'b', 'a'], 'd')).toEqual(['d', 'c', 'b'])
  })

  it('resolves bounded keyboard movement', () => {
    expect(resolveLayerNavigatorIndex('ArrowUp', 0, 100)).toBe(0)
    expect(resolveLayerNavigatorIndex('ArrowDown', 99, 100)).toBe(99)
    expect(resolveLayerNavigatorIndex('ArrowDown', 4, 100)).toBe(5)
    expect(resolveLayerNavigatorIndex('Home', 40, 100)).toBe(0)
    expect(resolveLayerNavigatorIndex('End', 40, 100)).toBe(99)
    expect(resolveLayerNavigatorIndex('Enter', 4, 100)).toBeNull()
    expect(resolveLayerNavigatorIndex('Home', 0, 0)).toBeNull()
  })
})
