/**
 * 붙여넣기 스테이징 순수 로직 (T4) — 라이브러리·React 무관, node 단위 테스트 대상.
 *
 * 파이프라인(계획 T4): 클립보드 TSV → 대상 범위 매핑(화면에 보이는 컬럼 순서 기준, 행×열
 * 크기 검사) → 레지스트리 `valueType` 기반 타입 검사 → 스테이징 셀 배열. "표시/적용/취소"는
 * 상위(SheetEditor)의 몫이고, 여기서는 "무엇을 어디에 넣을지 + 각 셀이 유효한지"만 계산한다.
 *
 * 경계 처리(엣지 케이스):
 * - 대상 열/행을 못 찾으면(현재 안 보이는 파라미터 등) 빈 스테이징 반환.
 * - 시트 끝(행/열)을 넘어가는 붙여넣기 데이터는 잘라내고 개수를 truncatedRows/Cols로 알린다.
 */
import type { ConditionGridColumn, ConditionGridRow, PasteStagingCell } from '@/grid/types'

/** buildPasteStaging 결과: 스테이징 셀 + 시트 경계 초과로 잘라낸 행/열 개수. */
export interface PasteStagingResult {
  staging: PasteStagingCell[]
  truncatedRows: number
  truncatedCols: number
}

/**
 * TSV 텍스트를 행×열 문자열 매트릭스로 파싱한다.
 *
 * 개행(row)·탭(cell) 분리. CRLF/CR는 LF로 정규화하고, 엑셀이 흔히 덧붙이는 **맨 끝 개행
 * 하나**만 무시한다(중간 빈 행은 보존 — 빈 셀=비우기 의도일 수 있으므로). 빈 입력은 [].
 */
export function parseTsv(tsv: string): string[][] {
  const normalized = tsv.replace(/\r\n?/g, '\n')
  const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  if (body === '') return []
  return body.split('\n').map((line) => line.split('\t'))
}

/** 셀 한 개 타입 검사 결과(내부용). */
interface CellCheck {
  value: string | null
  valid: boolean
  message?: string
}

/**
 * number 엄격 파싱: 정수/소수만 허용. 콤마·통화·퍼센트·지수 등 서식 문자열은 거부한다.
 *
 * 콤마 포함("1,234")은 이 패턴에서 걸러지고 `Number("1,234")`도 NaN이라 이중으로 안전하다.
 */
function isStrictNumber(trimmed: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(trimmed)
}

/** 컬럼 `valueType` 기준으로 붙여넣기 값 하나를 검사·정규화한다. 빈 값은 항상 유효(셀 비우기). */
function checkCell(raw: string, column: ConditionGridColumn): CellCheck {
  const trimmed = raw.trim()
  if (trimmed === '') return { value: null, valid: true }

  switch (column.valueType) {
    case 'number':
      return isStrictNumber(trimmed)
        ? { value: trimmed, valid: true }
        : { value: raw, valid: false, message: '숫자 형식이 아니다' }
    case 'choice':
      return column.choiceOptions?.includes(trimmed) === true
        ? { value: trimmed, valid: true }
        : { value: raw, valid: false, message: '선택지에 없는 값이다' }
    default:
      // text (및 아직 전용 에디터가 없는 date/boolean) — 자유 입력, 항상 유효.
      return { value: trimmed, valid: true }
  }
}

/**
 * 붙여넣기 대상 좌상단 셀 + 매트릭스를 스테이징 셀 배열로 매핑한다.
 *
 * - 대상 열: visibleColumns에서 target.parameterCode 인덱스부터 매트릭스 폭만큼 순서대로.
 * - 대상 행: rows에서 target.conditionId 인덱스부터 매트릭스 높이만큼 순서대로.
 * - 시트 끝을 넘어가는 행/열은 잘라내고 truncatedRows/Cols에 개수를 기록한다.
 * - 대상 열/행을 못 찾으면 빈 스테이징(엣지 케이스 — 과하게 처리하지 않는다).
 */
export function buildPasteStaging(
  target: { conditionId: string; parameterCode: string },
  matrix: readonly (readonly string[])[],
  visibleColumns: readonly ConditionGridColumn[],
  rows: readonly ConditionGridRow[],
): PasteStagingResult {
  const empty: PasteStagingResult = { staging: [], truncatedRows: 0, truncatedCols: 0 }
  if (matrix.length === 0) return empty

  const colStart = visibleColumns.findIndex((column) => column.key === target.parameterCode)
  const rowStart = rows.findIndex((row) => row.id === target.conditionId)
  if (colStart < 0 || rowStart < 0) return empty

  const matrixRows = matrix.length
  const matrixCols = matrix[0]?.length ?? 0
  const availableRows = rows.length - rowStart
  const availableCols = visibleColumns.length - colStart
  const mapRows = Math.min(matrixRows, availableRows)
  const mapCols = Math.min(matrixCols, availableCols)

  const staging: PasteStagingCell[] = []
  for (let r = 0; r < mapRows; r += 1) {
    const row = rows[rowStart + r]
    const matrixRow = matrix[r]
    for (let c = 0; c < mapCols; c += 1) {
      const column = visibleColumns[colStart + c]
      const check = checkCell(matrixRow?.[c] ?? '', column)
      const cell: PasteStagingCell = {
        conditionId: row.id,
        parameterCode: column.key,
        value: check.value,
        valid: check.valid,
      }
      if (check.message !== undefined) cell.message = check.message
      staging.push(cell)
    }
  }

  return {
    staging,
    truncatedRows: Math.max(0, matrixRows - availableRows),
    truncatedCols: Math.max(0, matrixCols - availableCols),
  }
}
