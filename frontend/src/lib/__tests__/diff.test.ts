import { describe, it, expect } from 'vitest'
import {
  diffLayerConditions,
  computeProjectDiff,
  getLayerChangeCount,
} from '@/lib/diff'
import type { ProjectLayerData } from '@/types'

// ---------------------------------------------------------------------------
// Helper to build a ProjectLayerData with minimal required fields
// ---------------------------------------------------------------------------
function makeLayer(
  overrides: Partial<ProjectLayerData> & {
    conditions: Record<string, unknown>
    backbone_conditions: Record<string, unknown>
  }
): ProjectLayerData {
  return {
    id: 1,
    layer_id: 1,
    layer_name: 'AA',
    step_seq: '010',
    layer_number: '01',
    backbone_product_id: 100,
    backbone_product_name: 'Product-A',
    sort_order: 1,
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

// ===========================================================================
// diffLayerConditions
// ===========================================================================
describe('diffLayerConditions', () => {
  it('returns empty array when conditions are identical', () => {
    const conditions = { col_a: '10', col_b: '20' }
    const backbone = { col_a: '10', col_b: '20' }
    expect(diffLayerConditions(conditions, backbone)).toEqual([])
  })

  it('detects changed values', () => {
    const conditions = { col_a: '10', col_b: '99' }
    const backbone = { col_a: '10', col_b: '20' }
    expect(diffLayerConditions(conditions, backbone)).toEqual(['col_b'])
  })

  it('detects keys present only in conditions (added)', () => {
    const conditions = { col_a: '10', col_new: '50' }
    const backbone = { col_a: '10' }
    expect(diffLayerConditions(conditions, backbone)).toEqual(['col_new'])
  })

  it('detects keys present only in backbone (removed)', () => {
    const conditions = { col_a: '10' }
    const backbone = { col_a: '10', col_old: '50' }
    expect(diffLayerConditions(conditions, backbone)).toEqual(['col_old'])
  })

  it('treats null, undefined, and empty string as equivalent', () => {
    const conditions: Record<string, unknown> = { a: null, b: undefined, c: '' }
    const backbone: Record<string, unknown> = { a: '', b: null, c: undefined }
    expect(diffLayerConditions(conditions, backbone)).toEqual([])
  })

  it('treats null vs non-empty string as different', () => {
    const conditions: Record<string, unknown> = { a: null }
    const backbone: Record<string, unknown> = { a: 'hello' }
    expect(diffLayerConditions(conditions, backbone)).toEqual(['a'])
  })

  it('compares numeric values by their string representation', () => {
    // Number 10 and string "10" should be equal after normalization
    const conditions: Record<string, unknown> = { x: 10 }
    const backbone: Record<string, unknown> = { x: '10' }
    expect(diffLayerConditions(conditions, backbone)).toEqual([])
  })

  it('returns empty array for two empty objects', () => {
    expect(diffLayerConditions({}, {})).toEqual([])
  })

  it('handles both objects empty except for null/undefined values', () => {
    const conditions: Record<string, unknown> = { a: null }
    const backbone: Record<string, unknown> = { a: undefined }
    expect(diffLayerConditions(conditions, backbone)).toEqual([])
  })
})

// ===========================================================================
// computeProjectDiff
// ===========================================================================
describe('computeProjectDiff', () => {
  it('returns zero totals for layers with no changes', () => {
    const layers: ProjectLayerData[] = [
      makeLayer({
        layer_id: 1,
        layer_name: 'AA',
        conditions: { a: '1' },
        backbone_conditions: { a: '1' },
      }),
    ]
    const result = computeProjectDiff(layers)
    expect(result.totalChangedCells).toBe(0)
    expect(result.totalChangedLayers).toBe(0)
    expect(result.layers).toEqual([])
  })

  it('counts changed cells across multiple layers', () => {
    const layers: ProjectLayerData[] = [
      makeLayer({
        layer_id: 1,
        layer_name: 'AA',
        conditions: { a: '1', b: '2' },
        backbone_conditions: { a: '1', b: '99' },
      }),
      makeLayer({
        id: 2,
        layer_id: 2,
        layer_name: 'BB',
        conditions: { a: '5', b: '6', c: '7' },
        backbone_conditions: { a: '50', b: '60', c: '7' },
      }),
    ]
    const result = computeProjectDiff(layers)
    expect(result.totalChangedCells).toBe(3) // 1 from AA + 2 from BB
    expect(result.totalChangedLayers).toBe(2)
    expect(result.layers).toHaveLength(2)

    expect(result.layers[0].layerId).toBe(1)
    expect(result.layers[0].changedCount).toBe(1)
    expect(result.layers[0].changedColumns).toEqual(['b'])

    expect(result.layers[1].layerId).toBe(2)
    expect(result.layers[1].changedCount).toBe(2)
    expect(result.layers[1].changedColumns).toEqual(['a', 'b'])
  })

  it('excludes layers with zero changes from the summary', () => {
    const layers: ProjectLayerData[] = [
      makeLayer({
        layer_id: 1,
        layer_name: 'AA',
        conditions: { a: '1' },
        backbone_conditions: { a: '1' },
      }),
      makeLayer({
        id: 2,
        layer_id: 2,
        layer_name: 'BB',
        conditions: { a: 'changed' },
        backbone_conditions: { a: 'original' },
      }),
    ]
    const result = computeProjectDiff(layers)
    expect(result.totalChangedLayers).toBe(1)
    expect(result.layers[0].layerName).toBe('BB')
  })

  it('returns empty summary for empty layers array', () => {
    const result = computeProjectDiff([])
    expect(result.totalChangedCells).toBe(0)
    expect(result.totalChangedLayers).toBe(0)
    expect(result.layers).toEqual([])
  })
})

// ===========================================================================
// getLayerChangeCount
// ===========================================================================
describe('getLayerChangeCount', () => {
  it('returns 0 when conditions match backbone', () => {
    const layer = makeLayer({
      conditions: { a: '1', b: '2' },
      backbone_conditions: { a: '1', b: '2' },
    })
    expect(getLayerChangeCount(layer)).toBe(0)
  })

  it('returns correct count of differing columns', () => {
    const layer = makeLayer({
      conditions: { a: '1', b: 'changed', c: 'also_changed' },
      backbone_conditions: { a: '1', b: '2', c: '3' },
    })
    expect(getLayerChangeCount(layer)).toBe(2)
  })

  it('returns count for layer with empty backbone', () => {
    const layer = makeLayer({
      conditions: { a: '1', b: '2' },
      backbone_conditions: {},
    })
    expect(getLayerChangeCount(layer)).toBe(2)
  })

  it('returns count for layer with empty conditions', () => {
    const layer = makeLayer({
      conditions: {},
      backbone_conditions: { a: '1', b: '2' },
    })
    expect(getLayerChangeCount(layer)).toBe(2)
  })
})
