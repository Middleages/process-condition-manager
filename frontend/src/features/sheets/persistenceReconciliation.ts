import type { QueryClient } from '@tanstack/react-query'

import type { CellsPatchOut, SheetOut } from '@/api/types'

import { fromCellUpdateOut, type DirtyCell, type PersistedCell } from './editStore'
import { applySavedToSheet } from './sheetAdapter'

/** 진행 중인 오래된 GET을 먼저 취소해 canonical PATCH cache가 뒤늦게 덮이지 않게 한다. */
export async function commitCanonicalSheetCells(
  queryClient: QueryClient,
  projectId: number,
  cells: readonly PersistedCell[],
): Promise<void> {
  const queryKey = ['sheet', projectId] as const
  await queryClient.cancelQueries({ queryKey, exact: true })
  queryClient.setQueryData<SheetOut>(queryKey, (previous) =>
    previous === undefined ? previous : applySavedToSheet(previous, cells),
  )
}

/**
 * 서버 응답은 base cache의 유일한 권위이고, request snapshot은 dirty 세대만 정리한다.
 * 호출 순서를 고정해 최신 local overlay가 canonical base 위에 남을 수 있게 한다.
 */
export function reconcileSuccessfulPatch(
  response: CellsPatchOut,
  requestSnapshot: readonly DirtyCell[],
  commitCanonical: (cells: readonly PersistedCell[]) => void | Promise<void>,
  markSnapshotSaved: (cells: readonly DirtyCell[]) => void,
): Promise<void> {
  return Promise.resolve(commitCanonical(response.cells.map(fromCellUpdateOut))).then(() => {
    markSnapshotSaved(requestSnapshot)
  })
}
