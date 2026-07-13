import { beforeEach, describe, expect, it } from 'vitest'

import type { ConditionGridRow } from '@/grid/types'

import {
  applyDirtyToRows,
  dirtyCellList,
  dirtyKey,
  removeSavedCells,
  selectDirtyCount,
  setDirtyCell,
  toCellStatuses,
  toCellUpdateIn,
  useEditStore,
  type DirtyCell,
  type DirtyCellMap,
} from './editStore'

const cell = (conditionId: string, parameterCode: string, value: string | null): DirtyCell => ({
  conditionId,
  parameterCode,
  value,
})

describe('setDirtyCell', () => {
  it('registers a cell and merges same-cell edits (last write wins)', () => {
    let map: DirtyCellMap = new Map()
    map = setDirtyCell(map, cell('11', 'spin', '1500'))
    map = setDirtyCell(map, cell('11', 'spin', '1600')) // 같은 셀 재편집
    map = setDirtyCell(map, cell('11', 'pr', 'pos'))
    expect(map.size).toBe(2)
    expect(map.get(dirtyKey('11', 'spin'))?.value).toBe('1600')
  })

  it('does not mutate the input map', () => {
    const base: DirtyCellMap = new Map()
    const next = setDirtyCell(base, cell('1', 'a', 'x'))
    expect(base.size).toBe(0)
    expect(next.size).toBe(1)
  })
})

describe('removeSavedCells', () => {
  it('drops saved cells whose value is unchanged', () => {
    let map: DirtyCellMap = new Map()
    map = setDirtyCell(map, cell('11', 'spin', '1500'))
    map = setDirtyCell(map, cell('11', 'pr', 'pos'))
    const next = removeSavedCells(map, [cell('11', 'spin', '1500')])
    expect(next.size).toBe(1)
    expect(next.has(dirtyKey('11', 'pr'))).toBe(true)
  })

  it('keeps a cell re-edited after the save snapshot (no data loss)', () => {
    let map: DirtyCellMap = new Map()
    map = setDirtyCell(map, cell('11', 'spin', '1500')) // 저장 요청 스냅샷 값
    map = setDirtyCell(map, cell('11', 'spin', '1700')) // 저장 중 재편집된 최신값
    const next = removeSavedCells(map, [cell('11', 'spin', '1500')]) // 옛 값만 저장 완료
    expect(next.size).toBe(1)
    expect(next.get(dirtyKey('11', 'spin'))?.value).toBe('1700') // 최신 편집 보존
  })

  it('ignores saved cells no longer present (discarded meanwhile)', () => {
    const next = removeSavedCells(new Map(), [cell('9', 'x', 'v')])
    expect(next.size).toBe(0)
  })
})

describe('toCellStatuses', () => {
  it('maps every dirty cell to a dirty status', () => {
    let map: DirtyCellMap = new Map()
    map = setDirtyCell(map, cell('11', 'spin', '1500'))
    map = setDirtyCell(map, cell('12', 'pr', null))
    const statuses = toCellStatuses(map)
    expect(statuses).toHaveLength(2)
    expect(statuses.every((status) => status.state === 'dirty')).toBe(true)
  })
})

describe('toCellUpdateIn', () => {
  it('converts to the API shape with a numeric condition_id', () => {
    expect(toCellUpdateIn(cell('11', 'spin', '1500'))).toEqual({
      condition_id: 11,
      parameter_code: 'spin',
      value: '1500',
    })
    expect(toCellUpdateIn(cell('12', 'pr', null)).value).toBeNull()
  })
})

describe('applyDirtyToRows', () => {
  const rows: ConditionGridRow[] = [
    {
      id: '11',
      layerKey: 'L',
      layerLabel: 'L',
      conditionLabel: 'C1',
      isPor: true,
      values: { spin: '1500', pr: 'pos' },
    },
    {
      id: '12',
      layerKey: 'L',
      layerLabel: 'L',
      conditionLabel: 'C2',
      isPor: false,
      values: { spin: '900' },
    },
  ]

  it('returns equivalent rows when there is no dirty', () => {
    expect(applyDirtyToRows(rows, new Map())).toEqual(rows)
  })

  it('overlays dirty values onto the matching row only', () => {
    let map: DirtyCellMap = new Map()
    map = setDirtyCell(map, cell('11', 'spin', '1600'))
    map = setDirtyCell(map, cell('11', 'pr', null))
    const out = applyDirtyToRows(rows, map)
    expect(out[0].values).toEqual({ spin: '1600', pr: null })
    expect(out[1]).toBe(rows[1]) // 더티 없는 행은 참조 그대로(불필요 리렌더 방지)
  })

  it('does not mutate the source rows', () => {
    let map: DirtyCellMap = new Map()
    map = setDirtyCell(map, cell('11', 'spin', '1600'))
    applyDirtyToRows(rows, map)
    expect(rows[0].values.spin).toBe('1500')
  })
})

describe('useEditStore', () => {
  beforeEach(() => {
    useEditStore.setState({ dirtyCells: new Map() })
  })

  it('setCell registers dirty and dedupes same-cell edits', () => {
    useEditStore.getState().setCell('11', 'spin', '1500')
    useEditStore.getState().setCell('11', 'spin', '1600')
    expect(selectDirtyCount(useEditStore.getState())).toBe(1)
    expect(dirtyCellList(useEditStore.getState().dirtyCells)[0].value).toBe('1600')
  })

  it('setCells stages a paste batch and lets the latest batch value win', () => {
    useEditStore.getState().setCell('11', 'spin', '1500')
    useEditStore.getState().setCells([
      cell('11', 'spin', '1700'),
      cell('12', 'pr', 'neg'),
    ])

    expect(selectDirtyCount(useEditStore.getState())).toBe(2)
    expect(useEditStore.getState().dirtyCells.get(dirtyKey('11', 'spin'))?.value).toBe('1700')
  })

  it('markSaved removes saved cells and clearAll empties the buffer', () => {
    useEditStore.getState().setCell('11', 'spin', '1500')
    useEditStore.getState().setCell('12', 'pr', 'pos')
    useEditStore.getState().markSaved([cell('11', 'spin', '1500')])
    expect(selectDirtyCount(useEditStore.getState())).toBe(1)
    useEditStore.getState().clearAll()
    expect(selectDirtyCount(useEditStore.getState())).toBe(0)
  })
})
