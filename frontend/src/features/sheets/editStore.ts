import { create } from 'zustand'

import type { CellUpdateIn } from '@/api/types'
import { overlayKey } from '@/grid/model'
import type { ConditionGridRow } from '@/grid/types'

/** 서버에 저장할 셀 값. 클라이언트 세대 정보는 없다. */
export interface PersistedCell {
  conditionId: string
  parameterCode: string
  value: string | null
}

/** 현재 미저장 세대. 값이 같아도 다시 편집하면 revision이 다르다. */
export interface DirtyCell extends PersistedCell {
  revision: number
}

export type DirtyCellMap = ReadonlyMap<string, DirtyCell>

export function dirtyKey(conditionId: string, parameterCode: string): string {
  return overlayKey(conditionId, parameterCode)
}

export function setDirtyCell(map: DirtyCellMap, cell: DirtyCell): DirtyCellMap {
  const next = new Map(map)
  next.set(dirtyKey(cell.conditionId, cell.parameterCode), cell)
  return next
}

export function setDirtyCells(map: DirtyCellMap, cells: readonly DirtyCell[]): DirtyCellMap {
  const next = new Map(map)
  for (const cell of cells) next.set(dirtyKey(cell.conditionId, cell.parameterCode), cell)
  return next
}

/** 요청 snapshot과 현재 dirty의 revision이 같을 때만 제거한다 (ABA 보호). */
export function removeSavedCells(
  map: DirtyCellMap,
  saved: readonly DirtyCell[],
): DirtyCellMap {
  const next = new Map(map)
  for (const cell of saved) {
    const key = dirtyKey(cell.conditionId, cell.parameterCode)
    if (next.get(key)?.revision === cell.revision) next.delete(key)
  }
  return next
}

export function dirtyCellList(map: DirtyCellMap): DirtyCell[] {
  return [...map.values()]
}

export function toCellUpdateIn(cell: PersistedCell): CellUpdateIn {
  return {
    condition_id: Number(cell.conditionId),
    parameter_code: cell.parameterCode,
    value: cell.value,
  }
}

export function fromCellUpdateOut(cell: CellUpdateIn): PersistedCell {
  return {
    conditionId: String(cell.condition_id),
    parameterCode: cell.parameter_code,
    value: cell.value,
  }
}

export function applyDirtyToRows<Row extends ConditionGridRow>(
  rows: readonly Row[],
  map: DirtyCellMap,
): Row[] {
  if (map.size === 0) return [...rows]
  const byCondition = new Map<string, DirtyCell[]>()
  for (const cell of map.values()) {
    const list = byCondition.get(cell.conditionId)
    if (list === undefined) byCondition.set(cell.conditionId, [cell])
    else list.push(cell)
  }
  return rows.map((row) => {
    const dirties = byCondition.get(row.id)
    if (dirties === undefined) return row
    const values = { ...row.values }
    for (const cell of dirties) values[cell.parameterCode] = cell.value
    return { ...row, values }
  })
}

interface EditState {
  dirtyCells: DirtyCellMap
  /** 지워지지 않는 store-wide monotonic allocator. */
  revision: number
  /** accepted edit/paste display buffer generation; project/session clearing never resets it. */
  displayGeneration: number
  /** successful durable mutation generation; project/session clearing never resets it. */
  persistedGeneration: number
  setCell(cell: PersistedCell): DirtyCell
  setCells(cells: readonly PersistedCell[]): DirtyCell[]
  advancePersistedGeneration(): number
  clearAll(): void
  markSaved(cells: readonly DirtyCell[]): void
}

export const useEditStore = create<EditState>((set) => ({
  dirtyCells: new Map(),
  revision: 0,
  displayGeneration: 0,
  persistedGeneration: 0,
  setCell: (cell) => {
    let allocated!: DirtyCell
    set((state) => {
      allocated = { ...cell, revision: state.revision + 1 }
      return {
        revision: allocated.revision,
        displayGeneration: state.displayGeneration + 1,
        dirtyCells: setDirtyCell(state.dirtyCells, allocated),
      }
    })
    return allocated
  },
  setCells: (cells) => {
    if (cells.length === 0) return []
    let allocated: DirtyCell[] = []
    set((state) => {
      let revision = state.revision
      allocated = cells.map((cell) => ({ ...cell, revision: (revision += 1) }))
      return {
        revision,
        displayGeneration: state.displayGeneration + 1,
        dirtyCells: setDirtyCells(state.dirtyCells, allocated),
      }
    })
    return allocated
  },
  advancePersistedGeneration: () => {
    let generation = 0
    set((state) => {
      generation = state.persistedGeneration + 1
      return { persistedGeneration: generation }
    })
    return generation
  },
  // 세션 전환은 map만 비운다. 늦은 응답이 새 세대를 지우지 못하게 counter는 유지.
  clearAll: () => set({ dirtyCells: new Map() }),
  markSaved: (cells) =>
    set((state) => ({ dirtyCells: removeSavedCells(state.dirtyCells, cells) })),
}))

export const selectDirtyCount = (state: EditState): number => state.dirtyCells.size
export const selectDirtyCells = (state: EditState): DirtyCellMap => state.dirtyCells
