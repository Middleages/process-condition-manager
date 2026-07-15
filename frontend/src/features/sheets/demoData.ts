/**
 * 합성 조건표 데이터 생성기 (백엔드 불필요, dev/데모 전용).
 *
 * 60행(조건 행) × 200컬럼(파라미터) 규모로 어댑터의 렌더/스크롤/그룹핑/카테고리 필터를
 * 체감·검증한다(EC2 성능 게이트, D-18 확인). 시드 고정으로 결과가 결정적이라 화면이 안정적.
 */
import type { ChoiceOptionAggregate } from '@/api/types'
import type {
  CellValueType,
  ConditionGridColumn,
  ConditionGridData,
  ConditionGridRow,
  SheetChoiceResource,
} from '@/grid/types'

const CATEGORIES = [
  { code: 'litho', label: 'Litho' },
  { code: 'coat', label: 'Coat' },
  { code: 'etch', label: 'Etch' },
  { code: 'clean', label: 'Clean' },
  { code: 'metro', label: 'Metro' },
] as const

const UNITS = ['nm', 'mJ', 'rpm', 'sec', 'degC', 'sccm']
const CHOICE_AGGREGATES: readonly ChoiceOptionAggregate[] = [
  demoChoiceAggregate('demo_polarity', ['pos', 'neg']),
  demoChoiceAggregate('demo_switch', ['on', 'off']),
  demoChoiceAggregate('demo_group', ['A', 'B', 'C']),
  demoChoiceAggregate('demo_level', ['low', 'mid', 'high']),
]

const CHOICE_AGGREGATE_BY_CODE = new Map(
  CHOICE_AGGREGATES.map((aggregate) => [aggregate.set_code, aggregate] as const),
)

function demoChoiceAggregate(setCode: string, codes: readonly string[]): ChoiceOptionAggregate {
  return {
    set_code: setCode,
    version: 1,
    items: codes.map((code, sortOrder) => ({
      code,
      label: code,
      sort_order: sortOrder,
      is_active: true,
    })),
  }
}

/** 결정적 난수(mulberry32). 시드가 같으면 항상 같은 시트가 나온다. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface DemoSheetOptions {
  columnCount?: number
  rowCount?: number
  seed?: number
  /** 셀이 채워질 확률(희소 데이터 재현). 기본 0.7 */
  fillRatio?: number
}

function buildColumns(count: number, rand: () => number): ConditionGridColumn[] {
  const columns: ConditionGridColumn[] = []
  for (let i = 0; i < count; i += 1) {
    const category = CATEGORIES[i % CATEGORIES.length]
    const roll = rand()
    const valueType: CellValueType = roll < 0.6 ? 'number' : roll < 0.85 ? 'text' : 'choice'
    const code = `${category.code.toUpperCase()}_P${String(i).padStart(3, '0')}`
    const choiceAggregate =
      valueType === 'choice' ? CHOICE_AGGREGATES[i % CHOICE_AGGREGATES.length] : null
    columns.push({
      key: code,
      headerName: code, // 실제 시트처럼 축약된 컬럼명(가독성 도전 재현)
      valueType,
      categoryCode: category.code,
      unit: valueType === 'number' ? UNITS[i % UNITS.length] : null,
      description: `${category.label} 파라미터 #${i} (${valueType})`,
      choiceSetCode: choiceAggregate?.set_code ?? null,
      choiceSetVersion: choiceAggregate?.version ?? null,
    })
  }
  return columns
}

function sampleValue(column: ConditionGridColumn, rand: () => number): string {
  if (column.valueType === 'number') {
    return String(Math.round(rand() * 10000) / 10)
  }
  if (column.valueType === 'choice') {
    const aggregate =
      column.choiceSetCode === null ? undefined : CHOICE_AGGREGATE_BY_CODE.get(column.choiceSetCode)
    const option = aggregate?.items[Math.floor(rand() * aggregate.items.length)]
    return option?.code ?? ''
  }
  return `txt-${Math.floor(rand() * 9000 + 1000)}`
}

function buildValues(
  columns: readonly ConditionGridColumn[],
  fillRatio: number,
  rand: () => number,
): Record<string, string | null> {
  const values: Record<string, string | null> = {}
  for (const column of columns) {
    if (rand() > fillRatio) continue // 희소 표현: 일부 셀은 비워 둔다
    values[column.key] = sampleValue(column, rand)
  }
  return values
}

function buildRows(
  rowCount: number,
  columns: readonly ConditionGridColumn[],
  fillRatio: number,
  rand: () => number,
): ConditionGridRow[] {
  const rows: ConditionGridRow[] = []
  let layerIndex = 0
  while (rows.length < rowCount) {
    layerIndex += 1
    const stepSeq = String(layerIndex * 10).padStart(3, '0')
    const layerId = `L${String(layerIndex).padStart(2, '0')}`
    const layerKey = `${stepSeq}|${layerId}`
    const layerLabel = `${layerId} (${stepSeq})`
    const remaining = rowCount - rows.length
    const groupSize = Math.min(remaining, 1 + Math.floor(rand() * 4)) // layer당 1~4 조건 행(그룹핑)
    const porIndex = Math.floor(rand() * groupSize) // layer당 POR 1개
    for (let c = 0; c < groupSize; c += 1) {
      rows.push({
        id: String(rows.length + 1),
        layerKey,
        layerLabel,
        conditionLabel: `C${c + 1}`,
        isPor: c === porIndex,
        values: buildValues(columns, fillRatio, rand),
      })
    }
  }
  return rows
}

export function makeDemoSheet(options: DemoSheetOptions = {}): ConditionGridData {
  const columnCount = options.columnCount ?? 200
  const rowCount = options.rowCount ?? 60
  const fillRatio = options.fillRatio ?? 0.7
  const rand = mulberry32(options.seed ?? 20260711)

  const columns = buildColumns(columnCount, rand)
  const rows = buildRows(rowCount, columns, fillRatio, rand)
  const choiceResources = new Map<string, SheetChoiceResource>()
  for (const column of columns) {
    if (column.choiceSetCode === null || choiceResources.has(column.choiceSetCode)) continue
    const aggregate = CHOICE_AGGREGATE_BY_CODE.get(column.choiceSetCode)
    if (aggregate === undefined) continue
    choiceResources.set(column.choiceSetCode, {
      setCode: column.choiceSetCode,
      targetVersion: aggregate.version,
      summaryVersion: aggregate.version,
      setIsActive: true,
      displayAggregate: aggregate,
      selectableAggregate: aggregate,
      selectionReady: true,
      isStale: false,
      loading: false,
      error: null,
      prepareToOpen: async () => undefined,
      retry: async () => undefined,
    })
  }
  return { columns, rows, choiceResources }
}
