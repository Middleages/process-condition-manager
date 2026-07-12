/**
 * 시트 조회 응답(`SheetOut`) → 그리드 어댑터 입력(`ConditionGridData`) 변환.
 *
 * API 레이어(snake_case)와 그리드 계약(도메인 타입)의 경계. 순수 함수라 node에서 단위
 * 테스트한다. 편집/저장/붙여넣기는 이 변환의 관심사가 아니다(T3/T4).
 */
import type { SheetColumnOut, SheetLockSummaryOut, SheetOut, SheetRowOut } from '@/api/types'
import type { ConditionGridColumn, ConditionGridData, ConditionGridRow } from '@/grid/types'

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

export interface SheetLockView {
  /** 비보유자에게는 읽기 전용. (T2에서는 편집 미구현이라 화면이 항상 읽기 전용이지만,
   *  잠금 요약의 의미는 T5 계약대로 여기서 해석해 둔다.) */
  readOnly: boolean
  /** "누가 편집 중" 배너 텍스트 — 타인이 편집 중일 때만 채워진다. */
  editingBy: string | null
}

/** 잠금 요약을 화면용 표현으로 변환한다. */
export function toLockView(lock: SheetLockSummaryOut): SheetLockView {
  const lockedByOther = lock.locked_by !== null && !lock.is_mine
  return { readOnly: lockedByOther, editingBy: lockedByOther ? lock.locked_by : null }
}
