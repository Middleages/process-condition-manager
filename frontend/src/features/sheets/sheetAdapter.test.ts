import { describe, expect, it } from 'vitest'

import type { ProjectLayerOut, SheetColumnOut, SheetOut } from '@/api/types'
import type { SheetChoiceResource } from '@/grid/types'

import type { PersistedCell } from './editStore'
import {
  applySavedToSheet,
  SheetAdapterError,
  shouldReplaceSheetWithError,
  toConditionGridData,
  toValidationInput,
  toValidationLayers,
  toValidationParameters,
  withValidationDisplayRows,
} from './sheetAdapter'

const sheet: SheetOut = {
  columns: [
    {
      parameter_code: 'spin_speed',
      display_name: 'Spin Speed',
      value_type: 'number',
      category_code: 'coat',
      unit: 'rpm',
      min_value: '100',
      max_value: '2000',
      required: true,
      pattern: null,
      pattern_hint: null,
      description: '스핀 속도',
      choice_set_code: null,
      choice_set_version: null,
      sort_order: 2,
    },
    {
      parameter_code: 'pr_type',
      display_name: 'PR Type',
      value_type: 'choice',
      category_code: 'coat',
      unit: null,
      min_value: null,
      max_value: null,
      required: false,
      pattern: null,
      pattern_hint: null,
      description: null,
      choice_set_code: 'photo_resist',
      choice_set_version: 7,
      sort_order: 1,
    },
  ],
  rows: [
    {
      condition_id: 11,
      layer_key: 'S01|L1',
      step_seq: '010',
      layer_id: 'ACT',
      layer_label: 'L1 (S01)',
      condition_label: 'POR',
      is_por: true,
      layer_sort_order: 4,
      condition_index: 2,
      cells: { spin_speed: '1500', pr_type: 'pos' },
    },
  ],
  lock: { locked_by: null, locked_at: null, expires_at: null, is_mine: true, heartbeat_seconds: 45 },
  validation_rules: [],
  validation_basis_hash: 'sha256:test',
}

const projectLayers: ProjectLayerOut[] = [
  {
    id: 1,
    layer_key: 'S01|L1',
    step_seq: 'S01',
    layer_id: 'L1',
    eqp_type: 'PHOTO',
    eqp_type_desc: 'Photo',
    area_name: 'COAT',
    sort_order: 4,
    condition_count: 1,
    cell_count: 2,
    source_project_id: null,
    source_layer_key: null,
  },
]

const emptyProjectLayer: ProjectLayerOut = {
  ...projectLayers[0],
  id: 2,
  layer_key: 'S02|L2',
  step_seq: 'S02',
  layer_id: 'L2',
  sort_order: 5,
  condition_count: 0,
  cell_count: 0,
}

describe('toConditionGridData', () => {
  it('orders columns by sort_order and maps to the grid contract', () => {
    const data = toConditionGridData(sheet)
    expect(data.columns.map((c) => c.key)).toEqual(['pr_type', 'spin_speed'])
    expect(data.columns[0]).toEqual({
      key: 'pr_type',
      headerName: 'PR Type',
      valueType: 'choice',
      categoryCode: 'coat',
      unit: null,
      description: null,
      choiceSetCode: 'photo_resist',
      choiceSetVersion: 7,
      minValue: null,
      maxValue: null,
      required: false,
      pattern: null,
      patternHint: null,
      sortOrder: 1,
    })
  })

  it('stringifies condition_id and passes sparse cells straight through', () => {
    const data = toConditionGridData(sheet)
    expect(data.rows[0]).toMatchObject({
      stepSeq: '010',
      layerId: 'ACT',
      conditionLabel: 'POR',
      isPor: true,
    })
    expect(data.rows[0].id).toBe('11')
    expect(data.rows[0].isPor).toBe(true)
    expect(data.rows[0].layerLabel).toBe('L1 (S01)')
    expect(data.rows[0].layerSortOrder).toBe(4)
    expect(data.rows[0].conditionIndex).toBe(2)
    expect(data.rows[0].values).toEqual({ spin_speed: '1500', pr_type: 'pos' })
  })

  it('does not mutate the source column order', () => {
    const original = sheet.columns.map((c) => c.parameter_code)
    toConditionGridData(sheet)
    expect(sheet.columns.map((c) => c.parameter_code)).toEqual(original)
  })

  const malformedBindingCases: ReadonlyArray<readonly [string, Partial<SheetColumnOut>]> = [
    ['choice missing version', { value_type: 'choice', choice_set_code: 'photo_resist', choice_set_version: null }],
    ['choice missing code', { value_type: 'choice', choice_set_code: null, choice_set_version: 7 }],
    ['choice padded code', { value_type: 'choice', choice_set_code: ' photo_resist ', choice_set_version: 7 }],
    ['non-choice with binding', { value_type: 'text', choice_set_code: 'photo_resist', choice_set_version: 7 }],
  ]

  it.each(malformedBindingCases)('fails closed for malformed column bindings: %s', (_label, overrides) => {
    const malformed: SheetOut = {
      ...sheet,
      columns: [{ ...sheet.columns[0], ...overrides }],
    }

    expect(() => toConditionGridData(malformed)).toThrowError(
      expect.objectContaining<Partial<SheetAdapterError>>({
        name: 'SheetAdapterError',
        code: 'invalid_choice_binding',
        requiresRefetch: true,
      }),
    )
  })

  it('fails closed when one set is bound to conflicting sheet versions', () => {
    const conflict: SheetOut = {
      ...sheet,
      columns: [
        sheet.columns[1],
        { ...sheet.columns[1], parameter_code: 'pr_type_2', choice_set_version: 8 },
      ],
    }

    expect(() => toConditionGridData(conflict)).toThrowError(
      expect.objectContaining<Partial<SheetAdapterError>>({
        code: 'conflicting_choice_versions',
        requiresRefetch: true,
      }),
    )
  })
})

describe('Sheet validation adapter boundary', () => {
  it('joins Sheet rows to complete Project layer metadata without parsing labels', () => {
    expect(toValidationLayers(sheet.rows, projectLayers)).toEqual([
      {
        key: 'S01|L1',
        layer_id: 'L1',
        step_seq: 'S01',
        eqp_type: 'PHOTO',
        area_name: 'COAT',
        sort_order: 4,
        conditions: [
          {
            id: 11,
            label: 'POR',
            condition_index: 2,
            is_por: true,
            values: { spin_speed: '1500', pr_type: 'pos' },
          },
        ],
      },
    ])
  })

  it('preserves empty Project layers because they count as searched prior layers', () => {
    const layers = toValidationLayers(sheet.rows, [emptyProjectLayer, ...projectLayers])

    expect(layers.map((layer) => layer.key)).toEqual(['S01|L1', 'S02|L2'])
    expect(layers[1]?.conditions).toEqual([])
  })

  it('fails closed when layer metadata is missing, duplicated, or disagrees on sort order', () => {
    expect(() => toValidationLayers(sheet.rows, [])).toThrowError(
      expect.objectContaining<Partial<SheetAdapterError>>({ code: 'missing_layer_metadata' }),
    )
    expect(() => toValidationLayers(sheet.rows, [...projectLayers, projectLayers[0]])).toThrowError(
      expect.objectContaining<Partial<SheetAdapterError>>({ code: 'duplicate_layer_metadata' }),
    )
    expect(() =>
      toValidationLayers([{ ...sheet.rows[0], layer_sort_order: 99 }], projectLayers),
    ).toThrowError(
      expect.objectContaining<Partial<SheetAdapterError>>({ code: 'layer_sort_order_mismatch' }),
    )
    expect(() =>
      toValidationLayers(sheet.rows, [{ ...projectLayers[0], condition_count: 2 }]),
    ).toThrowError(
      expect.objectContaining<Partial<SheetAdapterError>>({
        code: 'layer_condition_count_mismatch',
      }),
    )
  })

  it('builds choice definitions once from an exact-version deduplicated resource', () => {
    const resources = new Map<string, SheetChoiceResource>([
      ['photo_resist', choiceResource()],
    ])

    expect(toValidationParameters(sheet.columns, resources)).toEqual([
      {
        code: 'spin_speed',
        display_name: 'Spin Speed',
        value_type: 'number',
        required: true,
        pattern: null,
        pattern_hint: null,
        min_value: '100',
        max_value: '2000',
        choice_set_code: null,
        choices: [],
        sort_order: 2,
      },
      {
        code: 'pr_type',
        display_name: 'PR Type',
        value_type: 'choice',
        required: false,
        pattern: null,
        pattern_hint: null,
        min_value: null,
        max_value: null,
        choice_set_code: 'photo_resist',
        choices: [
          { code: 'pos', is_active: true },
          { code: 'legacy', is_active: false },
        ],
        sort_order: 1,
      },
    ])
  })

  it('ANDs option activity with ChoiceSet activity', () => {
    const inactive = choiceResource()
    inactive.setIsActive = false

    expect(
      toValidationParameters(sheet.columns, new Map([['photo_resist', inactive]]))[1]?.choices,
    ).toEqual([
      { code: 'pos', is_active: false },
      { code: 'legacy', is_active: false },
    ])
  })

  it('reuses one canonical choices array for columns bound to the same set version', () => {
    const resource = choiceResource()
    const items = resource.displayAggregate?.items ?? []
    let itemReads = 0
    if (resource.displayAggregate !== null) {
      Object.defineProperty(resource.displayAggregate, 'items', {
        configurable: true,
        get: () => {
          itemReads += 1
          return items
        },
      })
    }
    const duplicateChoiceColumn: SheetColumnOut = {
      ...sheet.columns[1],
      parameter_code: 'pr_type_backup',
      sort_order: 3,
    }

    const parameters = toValidationParameters(
      [...sheet.columns, duplicateChoiceColumn],
      new Map([['photo_resist', resource]]),
    )

    expect(parameters[1]?.choices).toBe(parameters[2]?.choices)
    expect(itemReads).toBe(1)
  })

  it('fails closed when a choice resource is unavailable or does not match the Sheet version', () => {
    expect(() => toValidationParameters(sheet.columns, new Map())).toThrowError(
      expect.objectContaining<Partial<SheetAdapterError>>({ code: 'choice_resource_unavailable' }),
    )
    const stale = choiceResource()
    stale.targetVersion = 8
    stale.displayAggregate = { ...stale.displayAggregate!, version: 8 }
    expect(() =>
      toValidationParameters(sheet.columns, new Map([['photo_resist', stale]])),
    ).toThrowError(
      expect.objectContaining<Partial<SheetAdapterError>>({
        code: 'choice_resource_version_mismatch',
      }),
    )
  })

  it('maps project identity and canonical layer-scoped rules into ValidationInput', () => {
    const scoped: SheetOut = {
      ...sheet,
      validation_rules: [
        {
          code: 'equipment_required',
          name: 'Equipment required',
          severity: 'warning',
          version: 3,
          scope: { layers: { eqp_types: ['PHOTO'], area_names: ['COAT'] } },
          spec: {
            schema_version: 1,
            type: 'required_if',
            when_parameter_code: 'pr_type',
            equals: 'pos',
            required_parameter_code: 'spin_speed',
          },
        },
      ],
    }

    const input = toValidationInput(
      { id: 42, line_id: 'L1', process_id: 'PROC', layers: projectLayers },
      scoped,
      new Map([['photo_resist', choiceResource()]]),
    )

    expect(input.context).toEqual({ project_id: 42, line_id: 'L1', process_id: 'PROC' })
    expect(input.rules[0]?.scope).toEqual({
      line_ids: [],
      process_ids: [],
      layer_ids: [],
      step_seqs: [],
      eqp_types: ['PHOTO'],
      area_names: ['COAT'],
    })
  })

  it('overlays committed display rows without rebuilding Python-mirror definitions', () => {
    const base = toValidationInput(
      { id: 42, line_id: 'L1', process_id: 'PROC', layers: projectLayers },
      sheet,
      new Map([['photo_resist', choiceResource()]]),
    )
    const displayRows = toConditionGridData(sheet).rows.map((row) => ({
      ...row,
      values: { ...row.values, spin_speed: '2500' },
    }))

    const overlaid = withValidationDisplayRows(base, displayRows)

    expect(overlaid.parameters).toBe(base.parameters)
    expect(overlaid.rules).toBe(base.rules)
    expect(overlaid.layers[0]?.conditions[0]?.values.spin_speed).toBe('2500')
    expect(base.layers[0]?.conditions[0]?.values.spin_speed).toBe('1500')
  })

  it('fails closed when display rows are not the exact adapted condition set', () => {
    const base = toValidationInput(
      { id: 42, line_id: 'L1', process_id: 'PROC', layers: projectLayers },
      sheet,
      new Map([['photo_resist', choiceResource()]]),
    )

    expect(() => withValidationDisplayRows(base, [])).toThrowError(
      expect.objectContaining<Partial<SheetAdapterError>>({ code: 'display_rows_mismatch' }),
    )
  })
})

describe('shouldReplaceSheetWithError', () => {
  it('keeps cached sheet data mounted when a background refetch fails', () => {
    expect(shouldReplaceSheetWithError(sheet, true)).toBe(false)
    expect(shouldReplaceSheetWithError(undefined, true)).toBe(true)
    expect(shouldReplaceSheetWithError(undefined, false)).toBe(false)
  })
})

describe('applySavedToSheet', () => {
  it('writes saved values into the matching row cells, keeping others', () => {
    const saved: PersistedCell[] = [{ conditionId: '11', parameterCode: 'spin_speed', value: '1600' }]
    const next = applySavedToSheet(sheet, saved)
    expect(next.rows[0].cells.spin_speed).toBe('1600')
    expect(next.rows[0].cells.pr_type).toBe('pos')
  })

  it('removes the cell key when the saved value is null (sparse representation)', () => {
    const saved: PersistedCell[] = [{ conditionId: '11', parameterCode: 'pr_type', value: null }]
    const next = applySavedToSheet(sheet, saved)
    expect('pr_type' in next.rows[0].cells).toBe(false)
  })

  it('does not mutate the source sheet', () => {
    applySavedToSheet(sheet, [{ conditionId: '11', parameterCode: 'spin_speed', value: '9999' }])
    expect(sheet.rows[0].cells.spin_speed).toBe('1500')
  })

  it('returns the same reference when there is nothing to apply', () => {
    expect(applySavedToSheet(sheet, [])).toBe(sheet)
  })
})

function choiceResource(): SheetChoiceResource {
  return {
    setCode: 'photo_resist',
    targetVersion: 7,
    summaryVersion: 7,
    setIsActive: true,
    displayAggregate: {
      set_code: 'photo_resist',
      version: 7,
      items: [
        { code: 'pos', label: 'Positive', sort_order: 1, is_active: true },
        { code: 'legacy', label: 'Legacy', sort_order: 2, is_active: false },
      ],
    },
    selectableAggregate: null,
    selectionReady: false,
    isStale: false,
    loading: false,
    error: null,
    prepareToOpen: async () => undefined,
    retry: async () => undefined,
  }
}
