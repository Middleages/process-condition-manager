/**
 * 시트 조회 응답(`SheetOut`) → 그리드 어댑터 입력(`ConditionGridData`) 변환.
 *
 * API 레이어(snake_case)와 그리드 계약(도메인 타입)의 경계. 순수 함수라 node에서 단위
 * 테스트한다. 편집/저장/붙여넣기는 이 변환의 관심사가 아니다(T3/T4).
 */
import type {
  ProjectLayerOut,
  SheetColumnOut,
  SheetOut,
  SheetRowOut,
  SheetValidationRuleOut,
} from '@/api/types'
import type {
  ConditionGridColumn,
  ConditionGridData,
  ConditionGridRow,
  SheetChoiceResource,
} from '@/grid/types'
import type {
  LayerInput,
  ParameterDefinition,
  ValidationInput,
  ValidationRuleDefinition,
} from '@/shared/domain/validation'

import type { PersistedCell } from './editStore'

export type SheetAdapterErrorCode =
  | 'invalid_choice_binding'
  | 'conflicting_choice_versions'
  | 'missing_layer_metadata'
  | 'duplicate_layer_metadata'
  | 'layer_sort_order_mismatch'
  | 'layer_condition_count_mismatch'
  | 'choice_resource_unavailable'
  | 'choice_resource_version_mismatch'

export interface AdaptedConditionGridColumn extends ConditionGridColumn {
  minValue: string | null
  maxValue: string | null
  required: boolean
  pattern: string | null
  patternHint: string | null
  sortOrder: number
}

export interface AdaptedConditionGridRow extends ConditionGridRow {
  layerSortOrder: number
  conditionIndex: number
}

export interface AdaptedConditionGridData extends Omit<ConditionGridData, 'columns' | 'rows'> {
  columns: readonly AdaptedConditionGridColumn[]
  rows: readonly AdaptedConditionGridRow[]
}

export type ValidationProjectSource = Pick<
  import('@/api/types').ProjectOut,
  'id' | 'line_id' | 'process_id' | 'layers'
>

/** 편집 잠금을 마운트하기 전 Sheet 계약을 fail-closed하는 typed error. */
export class SheetAdapterError extends Error {
  readonly requiresRefetch = true

  constructor(
    readonly code: SheetAdapterErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SheetAdapterError'
  }
}

export function assertSheetColumnBindings(columns: readonly SheetColumnOut[]): void {
  const versions = new Map<string, number>()
  for (const column of columns) {
    const code = column.choice_set_code
    const version = column.choice_set_version
    const hasCode = typeof code === 'string' && code !== '' && code === code.trim()
    const hasVersion = typeof version === 'number' && Number.isInteger(version) && version > 0

    if (column.value_type === 'choice') {
      if (!hasCode || !hasVersion) {
        throw new SheetAdapterError(
          'invalid_choice_binding',
          `Choice column ${column.parameter_code} requires a set code and positive version`,
        )
      }
      const normalizedCode = code
      const normalizedVersion = version
      const existing = versions.get(normalizedCode)
      if (existing !== undefined && existing !== normalizedVersion) {
        throw new SheetAdapterError(
          'conflicting_choice_versions',
          `Choice set ${normalizedCode} has conflicting Sheet versions`,
        )
      }
      versions.set(normalizedCode, normalizedVersion)
      continue
    }

    if (code !== null || version !== null) {
      throw new SheetAdapterError(
        'invalid_choice_binding',
        `Non-choice column ${column.parameter_code} cannot bind a choice set`,
      )
    }
  }
}

/** 컬럼 정의를 sort_order 순으로 정렬해 도메인 컬럼으로 변환한다. */
export function toConditionGridColumns(
  columns: readonly SheetColumnOut[],
): AdaptedConditionGridColumn[] {
  assertSheetColumnBindings(columns)
  return [...columns]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((column) => ({
      key: column.parameter_code,
      headerName: column.display_name,
      valueType: column.value_type,
      categoryCode: column.category_code,
      unit: column.unit,
      description: column.description,
      choiceSetCode: column.choice_set_code,
      choiceSetVersion: column.choice_set_version,
      minValue: column.min_value,
      maxValue: column.max_value,
      required: column.required,
      pattern: column.pattern,
      patternHint: column.pattern_hint,
      sortOrder: column.sort_order,
    }))
}

/** 본문 행을 도메인 행으로 변환한다. condition_id(number)는 그리드 계약상 문자열 id가 된다. */
export function toConditionGridRows(rows: readonly SheetRowOut[]): AdaptedConditionGridRow[] {
  return rows.map((row) => ({
    id: String(row.condition_id),
    layerKey: row.layer_key,
    layerLabel: row.layer_label,
    conditionLabel: row.condition_label,
    isPor: row.is_por,
    values: row.cells,
    layerSortOrder: row.layer_sort_order,
    conditionIndex: row.condition_index,
  }))
}

export function toConditionGridData(sheet: SheetOut): AdaptedConditionGridData {
  return {
    columns: toConditionGridColumns(sheet.columns),
    rows: toConditionGridRows(sheet.rows),
  }
}

/**
 * Join Sheet rows to the independently fetched Project layer metadata required by scoped rules.
 * Every Project layer is retained, including empty layers: each one advances prior-POR chronology.
 */
export function toValidationLayers(
  rows: readonly SheetRowOut[],
  projectLayers: readonly ProjectLayerOut[],
): readonly LayerInput[] {
  const metadataByKey = new Map<string, ProjectLayerOut>()
  for (const layer of projectLayers) {
    if (metadataByKey.has(layer.layer_key)) {
      throw new SheetAdapterError(
        'duplicate_layer_metadata',
        `Project contains duplicate layer metadata for ${layer.layer_key}`,
      )
    }
    metadataByKey.set(layer.layer_key, layer)
  }

  const rowsByLayer = new Map<string, SheetRowOut[]>()
  for (const row of rows) {
    const metadata = metadataByKey.get(row.layer_key)
    if (metadata === undefined) {
      throw new SheetAdapterError(
        'missing_layer_metadata',
        `Sheet row references missing Project layer ${row.layer_key}`,
      )
    }
    if (row.layer_sort_order !== metadata.sort_order) {
      throw new SheetAdapterError(
        'layer_sort_order_mismatch',
        `Sheet and Project disagree on layer order for ${row.layer_key}`,
      )
    }
    const layerRows = rowsByLayer.get(row.layer_key)
    if (layerRows === undefined) rowsByLayer.set(row.layer_key, [row])
    else layerRows.push(row)
  }

  for (const layer of projectLayers) {
    if ((rowsByLayer.get(layer.layer_key)?.length ?? 0) !== layer.condition_count) {
      throw new SheetAdapterError(
        'layer_condition_count_mismatch',
        `Sheet and Project disagree on condition count for ${layer.layer_key}`,
      )
    }
  }

  return [...projectLayers]
    .sort(compareProjectLayers)
    .map((layer) => ({
      key: layer.layer_key,
      layer_id: layer.layer_id,
      step_seq: layer.step_seq,
      eqp_type: layer.eqp_type,
      area_name: layer.area_name,
      sort_order: layer.sort_order,
      conditions: (rowsByLayer.get(layer.layer_key) ?? [])
        .slice()
        .sort(compareSheetRows)
        .map((row) => ({
          id: row.condition_id,
          label: row.condition_label,
          condition_index: row.condition_index,
          is_por: row.is_por,
          values: row.cells,
        })),
    }))
}

/**
 * Materialize evaluator definitions from deduplicated ChoiceSet resources. Options stay out of
 * SheetOut; columns bound to the same set/version reuse one canonical readonly choices array.
 */
export function toValidationParameters(
  columns: readonly SheetColumnOut[],
  choiceResources: ReadonlyMap<string, SheetChoiceResource>,
): readonly ParameterDefinition[] {
  assertSheetColumnBindings(columns)
  const canonicalChoicesBySet = new Map<string, ParameterDefinition['choices']>()
  return columns.map((column) => {
    let choices: ParameterDefinition['choices'] = []
    if (column.value_type === 'choice') {
      const setCode = column.choice_set_code
      const expectedVersion = column.choice_set_version
      if (setCode === null || expectedVersion === null) {
        throw new SheetAdapterError(
          'invalid_choice_binding',
          `Choice column ${column.parameter_code} has no exact binding`,
        )
      }
      const cachedChoices = canonicalChoicesBySet.get(setCode)
      if (cachedChoices !== undefined) {
        choices = cachedChoices
        return parameterDefinition(column, choices)
      }
      const resource = choiceResources.get(setCode)
      if (resource === undefined || resource.displayAggregate === null) {
        throw new SheetAdapterError(
          'choice_resource_unavailable',
          `Choice resource ${setCode} is not complete`,
        )
      }
      if (
        resource.setCode !== setCode ||
        resource.targetVersion !== expectedVersion ||
        resource.summaryVersion !== expectedVersion ||
        resource.displayAggregate.set_code !== setCode ||
        resource.displayAggregate.version !== expectedVersion
      ) {
        throw new SheetAdapterError(
          'choice_resource_version_mismatch',
          `Choice resource ${setCode} does not match the Sheet version`,
        )
      }
      if (typeof resource.setIsActive !== 'boolean' || resource.isStale) {
        throw new SheetAdapterError(
          'choice_resource_unavailable',
          `Choice resource ${setCode} has no current activity state`,
        )
      }
      const setIsActive = resource.setIsActive
      choices = Object.freeze(
        resource.displayAggregate.items.map((option) =>
          Object.freeze({
            code: option.code,
            is_active: setIsActive && option.is_active,
          }),
        ),
      )
      canonicalChoicesBySet.set(setCode, choices)
    }

    return parameterDefinition(column, choices)
  })
}

function parameterDefinition(
  column: SheetColumnOut,
  choices: ParameterDefinition['choices'],
): ParameterDefinition {
  return {
    code: column.parameter_code,
    display_name: column.display_name,
    value_type: column.value_type,
    required: column.required,
    pattern: column.pattern,
    pattern_hint: column.pattern_hint,
    min_value: column.min_value,
    max_value: column.max_value,
    choice_set_code: column.choice_set_code,
    choices,
    sort_order: column.sort_order,
  }
}

export function toValidationInput(
  project: ValidationProjectSource,
  sheet: SheetOut,
  choiceResources: ReadonlyMap<string, SheetChoiceResource>,
): ValidationInput {
  return {
    context: {
      project_id: project.id,
      line_id: project.line_id,
      process_id: project.process_id,
    },
    parameters: toValidationParameters(sheet.columns, choiceResources),
    layers: toValidationLayers(sheet.rows, project.layers),
    rules: sheet.validation_rules.map(toValidationRule),
  }
}

function toValidationRule(rule: SheetValidationRuleOut): ValidationRuleDefinition {
  const layers = rule.scope.layers
  return {
    code: rule.code,
    name: rule.name,
    severity: rule.severity,
    version: rule.version,
    scope: {
      line_ids: [],
      process_ids: [],
      layer_ids: layers?.layer_ids ?? [],
      step_seqs: layers?.step_seqs ?? [],
      eqp_types: layers?.eqp_types ?? [],
      area_names: layers?.area_names ?? [],
    },
    spec: rule.spec,
  }
}

function compareProjectLayers(left: ProjectLayerOut, right: ProjectLayerOut): number {
  return left.sort_order - right.sort_order || compareText(left.layer_key, right.layer_key)
}

function compareSheetRows(left: SheetRowOut, right: SheetRowOut): number {
  return left.condition_index - right.condition_index || left.condition_id - right.condition_id
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
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
export function applySavedToSheet(sheet: SheetOut, cells: readonly PersistedCell[]): SheetOut {
  if (cells.length === 0) return sheet
  const byCondition = new Map<number, PersistedCell[]>()
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
