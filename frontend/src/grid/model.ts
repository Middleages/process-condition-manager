/**
 * 그리드 어댑터의 순수(라이브러리 무관) 모델 로직.
 *
 * 여기에는 Glide/RevoGrid 등 어떤 그리드 라이브러리도 import 하지 않는다. 도메인 타입
 * (`./types`)만 알고, 컬럼 필터링·행 그룹핑·붙여넣기 대상 해석·스크롤 좌표 계산·오버레이
 * 색인 같은 순수 변환만 담는다. 이 파일이 node 환경에서 단위 테스트 가능한 계층이며,
 * Glide 컴포넌트(`GlideConditionGrid.tsx`)는 이 함수들을 캔버스에 배선하기만 한다.
 */
import type { CellStatus, ConditionGridColumn, ConditionGridRow, PasteStagingCell } from './types'

/**
 * 좌측 고정(식별) 컬럼 정의 — 라이브러리 무관 중립 표현.
 * 파라미터 컬럼이 아니라 행 필드(stepSeq/layerId/conditionLabel/isPor)에서 렌더된다.
 */
export const IDENTITY_COLUMNS = [
  { id: '__step_seq__', title: 'STEP SEQ' },
  { id: '__layer__', title: 'LAYER' },
  { id: '__condition__', title: '조건' },
  { id: '__por__', title: 'POR' },
] as const

export const IDENTITY_COLUMN_COUNT = IDENTITY_COLUMNS.length

/** 활성 카테고리로 파라미터 컬럼을 거른다. null/undefined = 전체. 원본 순서 보존. */
export function visibleParameterColumns(
  columns: readonly ConditionGridColumn[],
  activeCategory?: string | null,
): ConditionGridColumn[] {
  if (activeCategory == null) return [...columns]
  return columns.filter((column) => column.categoryCode === activeCategory)
}

/** 컬럼에서 카테고리 코드 목록을 최초 등장 순으로 뽑는다(카테고리 탭 생성용). */
export function distinctCategories(columns: readonly ConditionGridColumn[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const column of columns) {
    if (column.categoryCode != null && !seen.has(column.categoryCode)) {
      seen.add(column.categoryCode)
      result.push(column.categoryCode)
    }
  }
  return result
}

export type ColumnJumpResult =
  | { kind: 'empty' }
  | { kind: 'not-found' }
  | {
      kind: 'match'
      parameterCode: string
      categoryCode: string | null
      requiresCategoryChange: boolean
    }

/**
 * 컬럼 검색 결과를 현재 카테고리와 함께 해석한다.
 *
 * 같은 검색어가 여러 컬럼에 걸리면 현재 보이는 컬럼을 먼저 고른다. 숨겨진 결과만 있으면 그
 * 컬럼의 카테고리(null이면 전체 보기)로 전환해야 함을 호출자에게 알린다. 실제 상태 전환과
 * scroll 명령은 React commit 경계가 있으므로 이 순수 함수가 수행하지 않는다.
 */
export function resolveColumnJump(
  columns: readonly ConditionGridColumn[],
  activeCategory: string | null,
  rawQuery: string,
): ColumnJumpResult {
  const query = rawQuery.trim().toLocaleLowerCase()
  if (query === '') return { kind: 'empty' }

  const matches = (column: ConditionGridColumn): boolean =>
    column.key.trim().toLocaleLowerCase().includes(query) ||
    column.headerName.trim().toLocaleLowerCase().includes(query)
  const isVisible = (column: ConditionGridColumn): boolean =>
    activeCategory === null || column.categoryCode === activeCategory

  const match = columns.find((column) => isVisible(column) && matches(column)) ?? columns.find(matches)
  if (match === undefined) return { kind: 'not-found' }

  return {
    kind: 'match',
    parameterCode: match.key,
    categoryCode: match.categoryCode,
    requiresCategoryChange: !isVisible(match),
  }
}

/** 연속된 같은 layerKey 행의 그룹 한 개. */
export interface LayerGroup {
  layerKey: string
  layerLabel: string
  startRow: number
  rowCount: number
}

export interface RowGroupMeta {
  groups: LayerGroup[]
  /** 각 행이 속한 그룹 인덱스(0-based, 연속 그룹 순번) — 그룹 교대 배경색용. */
  groupIndexByRow: number[]
  /** 각 행이 자기 그룹의 첫 행인지 — 첫 행에만 layer 라벨 렌더(D-16, row span 없음). */
  isGroupStart: boolean[]
}

/**
 * 조건 행을 연속 layerKey 기준으로 그룹핑한다(D-16).
 *
 * rows는 이미 layer→조건 순서로 정렬돼 있다고 본다(백엔드 시트 응답 계약). 따라서
 * "연속" 판정만으로 그룹 경계가 잡힌다.
 */
export function computeRowGroups(rows: readonly ConditionGridRow[]): RowGroupMeta {
  const groups: LayerGroup[] = []
  const groupIndexByRow: number[] = []
  const isGroupStart: boolean[] = []

  let currentKey: string | null = null
  let currentGroup: LayerGroup | null = null

  rows.forEach((row, index) => {
    if (row.layerKey !== currentKey) {
      currentKey = row.layerKey
      currentGroup = { layerKey: row.layerKey, layerLabel: row.layerLabel, startRow: index, rowCount: 0 }
      groups.push(currentGroup)
      isGroupStart.push(true)
    } else {
      isGroupStart.push(false)
    }
    // currentGroup는 첫 반복에서 반드시 할당된다.
    currentGroup!.rowCount += 1
    groupIndexByRow.push(groups.length - 1)
  })

  return { groups, groupIndexByRow, isGroupStart }
}

/**
 * POR이 지정되지 않은 layer 그룹 목록을 등장 순서로 뽑는다(T7 경고 표시 근거).
 *
 * `computeRowGroups`의 그룹 경계를 재사용해, 각 그룹(=layer)에 `isPor=true`인 조건 행이
 * 하나도 없으면 "POR 미지정"으로 본다. 시트 응답은 layer→조건 순서로 정렬돼 있어 layer가
 * 연속이므로(한 layer=한 그룹) 그룹 단위 판정이 곧 layer 단위 판정이다. 순수 함수라 node에서
 * 단위 테스트한다. (Review 완결성 게이트는 Phase 5의 몫 — 여기서는 경고 근거만 제공하고 막지 않는다.)
 */
export function layersMissingPor(rows: readonly ConditionGridRow[]): LayerGroup[] {
  const { groups } = computeRowGroups(rows)
  return groups.filter(
    (group) => !rows.slice(group.startRow, group.startRow + group.rowCount).some((row) => row.isPor),
  )
}

/** number 셀 표시 문자열: 값 + 단위. 값은 파싱하지 않고 그대로 두어 정밀도/서식 손실을 피한다. */
export function formatNumberDisplay(value: string | null | undefined, unit?: string | null): string {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return ''
  return unit ? `${trimmed} ${unit}` : trimmed
}

/** 붙여넣기 매트릭스(행×열 문자열)를 TSV 텍스트로 되돌린다. onPaste 콜백 계약이 TSV 문자열이므로. */
export function matrixToTsv(values: readonly (readonly string[])[]): string {
  return values.map((row) => row.join('\t')).join('\n')
}

/**
 * 비동기 클립보드 콜백이 시작 당시의 시트 문맥에서 아직 유효한지 판정한다.
 *
 * 붙여넣기 권한이나 보이는 컬럼/행이 바뀌면 호출자가 새 generation을 발급한다. 콜백은
 * 시작할 때 캡처한 generation과 현재 generation이 같고, 현재 정책도 허용할 때만 좌표를
 * 해석할 수 있다. 라이브러리와 React 상태를 모르는 작은 공용 가드로 두어 어댑터와 상위
 * 스테이징 경계에서 같은 규칙을 적용한다.
 */
export function isCurrentPasteCallback(
  snapshotGeneration: symbol,
  currentGeneration: symbol,
  enabled: boolean,
): boolean {
  return enabled && snapshotGeneration === currentGeneration
}

/**
 * 커밋된 붙여넣기 문맥만 runtime ref에 게시한다.
 *
 * React 호출자는 반드시 layout effect 같은 commit 단계에서 이 함수를 호출한다. render 중
 * 만들어졌다가 폐기된 snapshot은 이 함수를 통과하지 않으므로, 이미 커밋된 콜백의 generation을
 * 오염시키지 않는다. 작은 production primitive로 분리해 그 경계를 순수 테스트할 수 있게 한다.
 */
export function commitPasteCallbackRuntime<T extends { generation: symbol }>(
  runtimeRef: { current: T },
  committed: T,
): void {
  runtimeRef.current = committed
}

/**
 * Glide의 [col, row] 인덱스를 도메인 셀 대상(조건 행 × 파라미터)으로 해석한다.
 * 셀 편집·붙여넣기 대상 해석에 공용으로 쓴다. 식별 컬럼(col < identityCount)은 대상이
 * 아니다 → null.
 */
export function resolveCellTarget(
  col: number,
  row: number,
  visibleColumns: readonly ConditionGridColumn[],
  rows: readonly ConditionGridRow[],
  identityCount: number,
): { conditionId: string; parameterCode: string } | null {
  const paramIndex = col - identityCount
  if (paramIndex < 0) return null
  const column = visibleColumns[paramIndex]
  const rowData = rows[row]
  if (column === undefined || rowData === undefined) return null
  return { conditionId: rowData.id, parameterCode: column.key }
}

/** 파라미터 코드를 (현재 보이는 컬럼 기준) Glide 컬럼 인덱스로 — 컬럼 검색-점프(T6). */
export function columnScrollIndex(
  parameterCode: string,
  visibleColumns: readonly ConditionGridColumn[],
  identityCount: number,
): number | null {
  const index = visibleColumns.findIndex((column) => column.key === parameterCode)
  return index < 0 ? null : identityCount + index
}

/** (조건 행, 파라미터)를 Glide [col, row] 스크롤 좌표로 — 셀 점프(검증 오류 → 셀). */
export function cellScrollTarget(
  conditionId: string,
  parameterCode: string,
  visibleColumns: readonly ConditionGridColumn[],
  rows: readonly ConditionGridRow[],
  identityCount: number,
): { col: number; row: number } | null {
  const rowIndex = rows.findIndex((row) => row.id === conditionId)
  const colIndex = visibleColumns.findIndex((column) => column.key === parameterCode)
  if (rowIndex < 0 || colIndex < 0) return null
  return { col: identityCount + colIndex, row: rowIndex }
}

/** 조건 행을 Glide Step Seq 셀 좌표로 — Layer 탐색기에서 행으로 세로 점프. */
export function conditionRowScrollTarget(
  conditionId: string,
  rows: readonly ConditionGridRow[],
): { col: 0; row: number } | null {
  const row = rows.findIndex((candidate) => candidate.id === conditionId)
  return row < 0 ? null : { col: 0, row }
}

/** 셀 오버레이(상태/스테이징) 조회용 합성 키. */
export function overlayKey(conditionId: string, parameterCode: string): string {
  return `${conditionId} ${parameterCode}`
}

/** 셀 상태 배열을 (조건,파라미터)→상태 맵으로 색인한다. 뒤 항목이 앞을 덮어쓴다. */
export function indexStatuses(statuses: readonly CellStatus[] | undefined): Map<string, CellStatus> {
  const map = new Map<string, CellStatus>()
  for (const status of statuses ?? []) {
    map.set(overlayKey(status.conditionId, status.parameterCode), status)
  }
  return map
}

/** 스테이징 셀 배열을 (조건,파라미터)→스테이징 맵으로 색인한다. */
export function indexStaging(
  staging: readonly PasteStagingCell[] | undefined,
): Map<string, PasteStagingCell> {
  const map = new Map<string, PasteStagingCell>()
  for (const cell of staging ?? []) {
    map.set(overlayKey(cell.conditionId, cell.parameterCode), cell)
  }
  return map
}

/** 서버 확정 값 위에 붙여넣기 스테이징 값을 미리보기한다. */
export function previewCellValue(
  serverValue: string | null,
  staging: PasteStagingCell | undefined,
): string | null {
  return staging === undefined ? serverValue : staging.value
}

/**
 * 헤더 컬럼 인덱스 → 그 컬럼의 헤더 툴팁 텍스트(레지스트리 description, 축약 컬럼명의 전체
 * 의미). 컬럼 검색-점프와 같은 identityCount 오프셋 규약을 쓴다(컬럼 가독성 T6).
 *
 * 다음이면 null → 툴팁을 띄우지 않는다: 좌측 식별 컬럼(col < identityCount) · 범위 밖 ·
 * description 없음/공백. 이 판정을 순수 함수로 떼어 두어 어댑터의 hover 배선과 분리 테스트한다.
 */
export function headerTooltip(
  col: number,
  visibleColumns: readonly ConditionGridColumn[],
  identityCount: number,
): string | null {
  const paramIndex = col - identityCount
  if (paramIndex < 0) return null
  const column = visibleColumns[paramIndex]
  if (column === undefined) return null
  const description = column.description?.trim()
  return description == null || description === '' ? null : description
}
