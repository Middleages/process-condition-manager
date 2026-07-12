/**
 * 더티 셀 버퍼 (자동저장 파이프라인 T3의 상태 저장소).
 *
 * 설계 원칙: **서버 데이터를 복제하지 않고 변경분(diff)만 보관한다.** 시트 본문은
 * react-query 캐시(서버 스냅샷)가 소유하고, 이 스토어는 아직 저장되지 않은 셀 편집만
 * (조건,파라미터)→값 맵으로 들고 있는다. 화면에 편집값을 보이는 것은 렌더 시점에 서버 행에
 * 이 diff를 얹는(`applyDirtyToRows`) 파생으로 처리한다 — 스토어는 여전히 diff만 안다.
 *
 * 순수 리듀서(아래 export 함수들)는 node에서 단위 테스트하고, Zustand 스토어는 그 위의
 * 얇은 래퍼다. 한 번에 시트 하나만 열리므로 모듈 단일 스토어로 충분하며, 시트 전환 시
 * `clearAll()`로 리셋한다(SheetEditor 마운트에서 호출).
 */
import { create } from 'zustand'

import { overlayKey } from '@/grid/model'
import type { CellStatus, ConditionGridRow } from '@/grid/types'
import type { CellUpdateIn } from '@/api/types'

/** 더티 셀 한 개. conditionId는 그리드 계약과 동일한 문자열 id. */
export interface DirtyCell {
  conditionId: string
  parameterCode: string
  value: string | null
}

/** (조건,파라미터) 합성 키 → 더티 셀. 키는 그리드 오버레이 키를 재사용한다. */
export type DirtyCellMap = ReadonlyMap<string, DirtyCell>

// ── 순수 리듀서 (node 단위 테스트 대상) ─────────────────────────────────────

/** 더티 맵 조회/색인용 합성 키. 그리드 오버레이 키와 동일 규칙을 재사용한다. */
export function dirtyKey(conditionId: string, parameterCode: string): string {
  return overlayKey(conditionId, parameterCode)
}

/** 더티 셀 하나를 등록/갱신한 새 맵을 만든다. 같은 셀은 마지막 값으로 덮어쓴다(합치기). */
export function setDirtyCell(map: DirtyCellMap, cell: DirtyCell): DirtyCellMap {
  const next = new Map(map)
  next.set(dirtyKey(cell.conditionId, cell.parameterCode), cell)
  return next
}

/**
 * 저장 성공분을 더티 맵에서 제거한 새 맵을 만든다.
 *
 * 경쟁 상황 보호: 저장 요청 스냅샷 이후 사용자가 같은 셀을 **다시** 편집했다면(현재 값이
 * 저장된 값과 다르면) 그 셀은 더티로 남긴다 — 최신 편집을 유실하지 않기 위함(데이터 유실 금지).
 */
export function removeSavedCells(map: DirtyCellMap, saved: readonly DirtyCell[]): DirtyCellMap {
  const next = new Map(map)
  for (const cell of saved) {
    const key = dirtyKey(cell.conditionId, cell.parameterCode)
    const current = next.get(key)
    if (current !== undefined && current.value === cell.value) {
      next.delete(key)
    }
  }
  return next
}

/** 더티 맵을 배열로. 저장 페이로드/오버레이 계산의 공용 소스. */
export function dirtyCellList(map: DirtyCellMap): DirtyCell[] {
  return [...map.values()]
}

/** 더티 맵 → 그리드 `statuses`(전부 `state: 'dirty'`). 더티 셀 시각 표시용. */
export function toCellStatuses(map: DirtyCellMap): CellStatus[] {
  return dirtyCellList(map).map((cell) => ({
    conditionId: cell.conditionId,
    parameterCode: cell.parameterCode,
    state: 'dirty' as const,
  }))
}

/** 더티 셀 → API 셀 갱신값. 문자열 conditionId를 number로 되돌린다(경계 변환). */
export function toCellUpdateIn(cell: DirtyCell): CellUpdateIn {
  return {
    condition_id: Number(cell.conditionId),
    parameter_code: cell.parameterCode,
    value: cell.value,
  }
}

/**
 * 서버 행(스냅샷) 위에 더티 값을 얹어 **표시용** 행을 만든다.
 *
 * 그리드는 `data.rows[].values`에서 셀 값을 읽고 편집 후 다시 그 값으로 리렌더하므로,
 * 더티 값을 여기서 얹지 않으면 편집한 셀이 저장 전 서버값으로 되돌아 보인다. 더티가 없으면
 * 원본 배열을 그대로 반환하고, 더티가 있는 행만 얕은 복제해 값에 덮어쓴다.
 */
export function applyDirtyToRows(
  rows: readonly ConditionGridRow[],
  map: DirtyCellMap,
): ConditionGridRow[] {
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

// ── Zustand 스토어 ─────────────────────────────────────────────────────────

interface EditState {
  dirtyCells: DirtyCellMap
  /** 셀 편집 확정 → 더티 등록(마지막 값으로 합치기). */
  setCell(conditionId: string, parameterCode: string, value: string | null): void
  /** 변경 취소 — 더티 버퍼 전체 폐기. */
  clearAll(): void
  /** 저장 성공분 제거(재편집분은 보존). */
  markSaved(cells: readonly DirtyCell[]): void
}

export const useEditStore = create<EditState>((set) => ({
  dirtyCells: new Map(),
  setCell: (conditionId, parameterCode, value) =>
    set((state) => ({
      dirtyCells: setDirtyCell(state.dirtyCells, { conditionId, parameterCode, value }),
    })),
  clearAll: () => set({ dirtyCells: new Map() }),
  markSaved: (cells) => set((state) => ({ dirtyCells: removeSavedCells(state.dirtyCells, cells) })),
}))

/** 더티 개수 셀렉터(상태 표시줄용). */
export const selectDirtyCount = (state: EditState): number => state.dirtyCells.size

/** 더티 맵 셀렉터(오버레이/표시 행 파생용). */
export const selectDirtyCells = (state: EditState): DirtyCellMap => state.dirtyCells
