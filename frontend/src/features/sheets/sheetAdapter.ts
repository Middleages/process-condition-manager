/**
 * 시트 조회 응답(`SheetOut`) → 그리드 어댑터 입력(`ConditionGridData`) 변환.
 *
 * API 레이어(snake_case)와 그리드 계약(도메인 타입)의 경계. 순수 함수라 node에서 단위
 * 테스트한다. 편집/저장/붙여넣기는 이 변환의 관심사가 아니다(T3/T4).
 */
import type { SheetColumnOut, SheetOut, SheetRowOut } from '@/api/types'
import type { ConditionGridColumn, ConditionGridData, ConditionGridRow } from '@/grid/types'

import type { DirtyCell } from './editStore'

/** 컬럼 정의를 sort_order 순으로 정렬해 도메인 컬럼으로 변환한다. */
export function toConditionGridColumns(
  columns: readonly SheetColumnOut[],
): ConditionGridColumn[] {
  return [...columns]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((column) => ({
      key: column.parameter_code,
      headerName: column.display_name,
      valueType: column.value_type,
      categoryCode: column.category_code,
      unit: column.unit,
      description: column.description,
      choiceOptions: column.choice_options,
    }))
}

/** 본문 행을 도메인 행으로 변환한다. condition_id(number)는 그리드 계약상 문자열 id가 된다. */
export function toConditionGridRows(rows: readonly SheetRowOut[]): ConditionGridRow[] {
  return rows.map((row) => ({
    id: String(row.condition_id),
    layerKey: row.layer_key,
    layerLabel: row.layer_label,
    conditionLabel: row.condition_label,
    isPor: row.is_por,
    values: row.cells,
  }))
}

export function toConditionGridData(sheet: SheetOut): ConditionGridData {
  return {
    columns: toConditionGridColumns(sheet.columns),
    rows: toConditionGridRows(sheet.rows),
  }
}

/** 캐시된 시트가 있으면 백그라운드 재조회 오류로 편집기를 교체하지 않는다. */
export function shouldReplaceSheetWithError(
  sheet: SheetOut | undefined,
  isError: boolean,
): boolean {
  return isError && sheet === undefined
}

/**
 * 저장 성공분을 서버 스냅샷(`SheetOut`)에 반영한 새 스냅샷을 만든다(T3 자동저장).
 *
 * 자동저장은 더티 diff만 서버로 보내고, 성공하면 이 함수로 캐시된 서버 행에 그 값을 확정
 * 반영한다. 그래야 더티 제거 후에도 그리드가 저장된 값을 계속 보여준다(스냅샷 되돌림 방지).
 * value=null(셀 비우기)은 희소 표현을 지켜 키를 제거한다.
 */
export function applySavedToSheet(sheet: SheetOut, cells: readonly DirtyCell[]): SheetOut {
  if (cells.length === 0) return sheet
  const byCondition = new Map<number, DirtyCell[]>()
  for (const cell of cells) {
    const id = Number(cell.conditionId)
    const list = byCondition.get(id)
    if (list === undefined) byCondition.set(id, [cell])
    else list.push(cell)
  }
  return {
    ...sheet,
    rows: sheet.rows.map((row) => {
      const dirties = byCondition.get(row.condition_id)
      if (dirties === undefined) return row
      const nextCells: Record<string, string | null> = { ...row.cells }
      for (const cell of dirties) {
        if (cell.value === null) delete nextCells[cell.parameterCode]
        else nextCells[cell.parameterCode] = cell.value
      }
      return { ...row, cells: nextCells }
    }),
  }
}
