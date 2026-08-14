import { beforeEach, describe, expect, it } from 'vitest'

import type { ConditionGridRow } from '@/grid/types'

import {
  applyDirtyToRows,
  applyInvalidDraftsToRows,
  dirtyKey,
  fromCellUpdateOut,
  removeSavedCells,
  pruneInvalidDraftMap,
  selectInvalidDraftCount,
  selectInvalidDrafts,
  setDirtyCell,
  setDirtyCells,
  toCellUpdateIn,
  useEditStore,
  type DirtyCell,
  type PersistedCell,
} from './editStore'
import type { InvalidCellDraft } from '@/grid/types'

const invalid = (rawValue = 'abc'): InvalidCellDraft => ({
  conditionId: '1',
  parameterCode: 'spin',
  rawValue,
  code: 'invalid_decimal',
  message: '숫자로 입력하세요',
  constraint: null,
})

const persisted = (
  value: string | null,
  parameterCode = 'spin',
): PersistedCell => ({ conditionId: '1', parameterCode, value })

const dirty = (value: string | null, revision: number, parameterCode = 'spin'): DirtyCell => ({
  ...persisted(value, parameterCode),
  revision,
})

describe('revision reducers', () => {
  it('stores a revisioned cell without mutating the source map', () => {
    const source = new Map<string, DirtyCell>()
    const cell = dirty('100', 1)
    const next = setDirtyCell(source, cell)
    expect(source.size).toBe(0)
    expect(next.get(dirtyKey('1', 'spin'))).toBe(cell)
  })

  it('merges an atomic batch and keeps its exact snapshot objects', () => {
    const source = new Map<string, DirtyCell>()
    const cells = [dirty('100', 1), dirty('memo', 2, 'note')]
    const next = setDirtyCells(source, cells)
    expect(next.get(dirtyKey('1', 'spin'))).toBe(cells[0])
    expect(next.get(dirtyKey('1', 'note'))).toBe(cells[1])
  })

  it('removes only the matching request revision, never a value-equal newer edit', () => {
    const oldRequest = dirty('A', 1)
    const abaCurrent = dirty('A', 3)
    const map = new Map([[dirtyKey('1', 'spin'), abaCurrent]])
    expect(removeSavedCells(map, [oldRequest]).get(dirtyKey('1', 'spin'))).toBe(abaCurrent)
    expect(removeSavedCells(map, [abaCurrent]).size).toBe(0)
  })
})

describe('transport and display projections', () => {
  it('converts API snake_case without inventing a client revision', () => {
    expect(fromCellUpdateOut({ condition_id: 9, parameter_code: 'mode', value: 'AUTO' })).toEqual({
      conditionId: '9',
      parameterCode: 'mode',
      value: 'AUTO',
    })
    expect(fromCellUpdateOut({ condition_id: 9, parameter_code: 'mode', value: 'AUTO' })).not.toHaveProperty(
      'revision',
    )
  })

  it('converts a dirty snapshot to the string-preserving API shape', () => {
    expect(toCellUpdateIn(dirty('001.5000', 42))).toEqual({
      condition_id: 1,
      parameter_code: 'spin',
      value: '001.5000',
    })
  })

  it('overlays dirty values without mutating the server rows', () => {
    const rows: ConditionGridRow[] = [
      {
        id: '1',
        layerKey: 'L1',
        stepSeq: 'S01',
        layerId: 'L1',
        layerLabel: 'L1',
        conditionLabel: 'C1',
        isPor: true,
        values: { spin: '90' },
      },
    ]
    const next = applyDirtyToRows(rows, new Map([[dirtyKey('1', 'spin'), dirty('100', 1)]]))
    expect(next[0].values.spin).toBe('100')
    expect(rows[0].values.spin).toBe('90')
    expect(applyDirtyToRows(rows, new Map())).toEqual(rows)
  })

  it('overlays a raw invalid draft without adding a dirty cell', () => {
    const rows: ConditionGridRow[] = [
      {
        id: '1', layerKey: 'L1', stepSeq: 'S01', layerId: 'L1', layerLabel: 'L1',
        conditionLabel: 'C1', isPor: true, values: { spin: '90' },
      },
    ]
    useEditStore.getState().setInvalidDraft(invalid())
    expect(useEditStore.getState().dirtyCells.size).toBe(0)
    expect(applyInvalidDraftsToRows(rows, useEditStore.getState().invalidDrafts)[0].values.spin)
      .toBe('abc')
    expect(rows[0].values.spin).toBe('90')
  })

  it('prunes drafts whose condition or parameter disappeared', () => {
    const rows: ConditionGridRow[] = [
      {
        id: '1', layerKey: 'L1', stepSeq: 'S01', layerId: 'L1', layerLabel: 'L1',
        conditionLabel: 'C1', isPor: true, values: { spin: '90' },
      },
    ]
    const columns = [{ key: 'spin' }]
    const retained = new Map([
      [dirtyKey('1', 'spin'), invalid()],
      [dirtyKey('gone', 'spin'), { ...invalid(), conditionId: 'gone' }],
      [dirtyKey('1', 'gone'), { ...invalid(), parameterCode: 'gone' }],
    ])
    expect([...pruneInvalidDraftMap(retained, rows, columns).keys()])
      .toEqual([dirtyKey('1', 'spin')])
  })
})

describe('useEditStore monotonic allocator', () => {
  beforeEach(() => {
    useEditStore.getState().clearAll()
  })

  it('increments every assignment, including A to B to A', () => {
    const generationBefore = useEditStore.getState().displayGeneration
    const first = useEditStore.getState().setCell(persisted('A'))
    const second = useEditStore.getState().setCell(persisted('B'))
    const third = useEditStore.getState().setCell(persisted('A'))
    expect([first.revision, second.revision, third.revision]).toEqual([
      first.revision,
      first.revision + 1,
      first.revision + 2,
    ])
    expect(useEditStore.getState().displayGeneration).toBe(generationBefore + 3)
    useEditStore.getState().markSaved([first])
    expect(useEditStore.getState().dirtyCells.get(dirtyKey('1', 'spin'))).toBe(third)
  })

  it('allocates a paste batch atomically in input order and returns the installed snapshots', () => {
    const generationBefore = useEditStore.getState().displayGeneration
    const snapshots = useEditStore
      .getState()
      .setCells([persisted('1.5'), persisted('AUTO', 'mode')])
    expect(snapshots[1].revision).toBe(snapshots[0].revision + 1)
    expect(useEditStore.getState().dirtyCells.get(dirtyKey('1', 'spin'))).toBe(snapshots[0])
    expect(useEditStore.getState().dirtyCells.get(dirtyKey('1', 'mode'))).toBe(snapshots[1])
    expect(useEditStore.getState().displayGeneration).toBe(generationBefore + 1)
  })

  it('clearAll empties the map but never resets the global revision counter', () => {
    const beforeClear = useEditStore.getState().setCell(persisted('old'))
    const displayBeforeClear = useEditStore.getState().displayGeneration
    const persistedBeforeClear = useEditStore.getState().advancePersistedGeneration()
    useEditStore.getState().clearAll()
    const afterClear = useEditStore.getState().setCell(persisted('new'))
    expect(afterClear.revision).toBeGreaterThan(beforeClear.revision)
    expect(useEditStore.getState().displayGeneration).toBeGreaterThan(displayBeforeClear)
    expect(useEditStore.getState().persistedGeneration).toBe(persistedBeforeClear)
    useEditStore.getState().markSaved([beforeClear])
    expect(useEditStore.getState().dirtyCells.get(dirtyKey('1', 'spin'))).toBe(afterClear)
  })

  it('advances durable generations monotonically for successful mutation batches', () => {
    const first = useEditStore.getState().advancePersistedGeneration()
    const second = useEditStore.getState().advancePersistedGeneration()

    expect(second).toBe(first + 1)
    expect(useEditStore.getState().persistedGeneration).toBe(second)
  })

  it('clears one invalid coordinate and clears invalid drafts with the session', () => {
    useEditStore.getState().setInvalidDraft(invalid())
    useEditStore.getState().setInvalidDraft({ ...invalid(), parameterCode: 'mode' })
    useEditStore.getState().clearInvalidDraft('1', 'spin')
    expect(useEditStore.getState().invalidDrafts.has(dirtyKey('1', 'spin'))).toBe(false)
    expect(useEditStore.getState().invalidDrafts.has(dirtyKey('1', 'mode'))).toBe(true)
    expect(selectInvalidDrafts(useEditStore.getState())).toBe(useEditStore.getState().invalidDrafts)
    expect(selectInvalidDraftCount(useEditStore.getState())).toBe(1)
    const revisionBefore = useEditStore.getState().revision
    const displayBefore = useEditStore.getState().displayGeneration
    const persistedBefore = useEditStore.getState().persistedGeneration
    useEditStore.getState().clearAll()
    expect(useEditStore.getState().invalidDrafts.size).toBe(0)
    expect(selectInvalidDrafts(useEditStore.getState()).size).toBe(0)
    expect(selectInvalidDraftCount(useEditStore.getState())).toBe(0)
    expect(useEditStore.getState().revision).toBe(revisionBefore)
    expect(useEditStore.getState().displayGeneration).toBe(displayBefore)
    expect(useEditStore.getState().persistedGeneration).toBe(persistedBefore)
  })
})
