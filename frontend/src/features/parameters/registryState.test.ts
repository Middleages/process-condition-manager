import { describe, expect, it, vi } from 'vitest'

import type { CategoryOut, ChoiceSetSummaryOut, ParameterOut } from '@/api/types'

import {
  authorizeParameterChoiceSet,
  canonicalizeParameterRegistryState,
  deriveParameterChoiceSetPickerState,
  filterParameterRegistry,
  parseParameterRegistrySearch,
  reconcileParameterChoiceSetAuthorization,
  serializeParameterRegistrySearch,
  shouldIncludeInactive,
} from './registryState'

const categories: CategoryOut[] = [
  { id: 10, code: 'photo', display_name: 'Photolithography', sort_order: 0, is_active: true },
  { id: 20, code: 'etch', display_name: 'Dry Etch', sort_order: 1, is_active: false },
]

function choiceSet(
  code: string,
  displayName: string,
  isActive = true,
): ChoiceSetSummaryOut {
  return {
    code,
    display_name: displayName,
    description: null,
    is_active: isActive,
    version: 1,
    option_count: 2,
    active_option_count: 2,
    parameter_usage_count: 0,
    profile_usage_fields: [],
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  }
}

const equipmentMode = choiceSet('equipment_mode', 'Equipment mode')
const chamberMode = choiceSet('chamber_mode', 'Chamber mode')

const parameters: ParameterOut[] = [
  {
    id: 31,
    code: 'exposure_dose',
    display_name: 'Exposure Dose',
    description: 'Wafer illumination target',
    value_type: 'number',
    category_id: 10,
    unit: 'mJ',
    min_value: '0',
    max_value: '100',
    choice_set: null,
    sort_order: 0,
    is_active: true,
  },
  {
    id: 18,
    code: 'etch_mode',
    display_name: 'Etch Mode',
    description: 'Chamber recipe family',
    value_type: 'choice',
    category_id: 20,
    unit: null,
    min_value: null,
    max_value: null,
    choice_set: chamberMode,
    sort_order: 1,
    is_active: false,
  },
  {
    id: 7,
    code: 'operator_note',
    display_name: 'Operator Note',
    description: null,
    value_type: 'text',
    category_id: null,
    unit: null,
    min_value: null,
    max_value: null,
    choice_set: null,
    sort_order: 2,
    is_active: true,
  },
]

describe('parameter registry URL state', () => {
  it('uses active defaults and accepts only text, number, and choice filters', () => {
    expect(parseParameterRegistrySearch(new URLSearchParams())).toEqual({
      query: '',
      category: null,
      type: null,
      active: 'active',
      edit: { kind: 'closed' },
    })
    expect(parseParameterRegistrySearch(new URLSearchParams('type=text')).type).toBe('text')
    expect(parseParameterRegistrySearch(new URLSearchParams('type=number')).type).toBe('number')
    expect(parseParameterRegistrySearch(new URLSearchParams('type=choice')).type).toBe('choice')
    expect(parseParameterRegistrySearch(new URLSearchParams('type=date')).type).toBeNull()
    expect(parseParameterRegistrySearch(new URLSearchParams('type=boolean')).type).toBeNull()
  })

  it('parses and canonicalizes editor targets', () => {
    expect(parseParameterRegistrySearch(new URLSearchParams('edit=new')).edit).toEqual({
      kind: 'new',
    })
    expect(parseParameterRegistrySearch(new URLSearchParams('edit=042')).edit).toEqual({
      kind: 'existing',
      id: 42,
    })
    expect(
      serializeParameterRegistrySearch(
        parseParameterRegistrySearch(new URLSearchParams('edit=042')),
      ).toString(),
    ).toBe('edit=42')
    expect(parseParameterRegistrySearch(new URLSearchParams('edit=0')).edit).toEqual({
      kind: 'invalid',
      raw: '0',
    })
  })

  it('repairs unknown categories and serializes canonical non-default state', () => {
    const parsed = parseParameterRegistrySearch(
      new URLSearchParams('query=dose&category=missing&type=number&active=all&edit=bad'),
    )

    const canonical = canonicalizeParameterRegistryState(parsed, new Set(['photo']))
    expect(canonical.category).toBeNull()
    expect(serializeParameterRegistrySearch(canonical).toString()).toBe(
      'query=dose&type=number&active=all&edit=bad',
    )
  })
})

describe('parameter registry filtering', () => {
  const defaultState = parseParameterRegistrySearch(new URLSearchParams())

  it.each([
    ['parameter code', 'EXPOSURE', [31]],
    ['display name', 'operator NOTE', [7]],
    ['category code', 'PHOTO', [31]],
    ['category display name', 'photolithOGRAPHY', [31]],
    ['unit', 'MJ', [31]],
    ['description', 'ILLUMINATION', [31]],
    ['ChoiceSet code', 'CHAMBER_MODE', []],
  ])('searches %s case-insensitively in the active view', (_field, query, ids) => {
    expect(
      filterParameterRegistry(parameters, categories, { ...defaultState, query }).map(
        (parameter) => parameter.id,
      ),
    ).toEqual(ids)
  })

  it('finds managed-set code and name when inactive rows are included', () => {
    const all = { ...defaultState, active: 'all' as const }

    expect(
      filterParameterRegistry(parameters, categories, { ...all, query: 'CHAMBER_MODE' }).map(
        (parameter) => parameter.id,
      ),
    ).toEqual([18])
    expect(
      filterParameterRegistry(parameters, categories, { ...all, query: 'chamber mode' }).map(
        (parameter) => parameter.id,
      ),
    ).toEqual([18])
  })

  it('combines category, type, and active predicates without reordering', () => {
    expect(
      filterParameterRegistry(parameters, categories, {
        ...defaultState,
        category: 'photo',
        type: 'number',
        active: 'active',
      }).map((parameter) => parameter.id),
    ).toEqual([31])
    expect(
      filterParameterRegistry(parameters, categories, {
        ...defaultState,
        active: 'all',
      }).map((parameter) => parameter.id),
    ).toEqual([31, 18, 7])
  })

  it('does not depend on locale-sensitive case folding', () => {
    const localeLowerCase = vi
      .spyOn(String.prototype, 'toLocaleLowerCase')
      .mockImplementation(() => {
        throw new Error('locale-sensitive lowercasing used')
      })

    try {
      expect(
        filterParameterRegistry(parameters, categories, {
          ...defaultState,
          query: 'EXPOSURE',
        }).map((parameter) => parameter.id),
      ).toEqual([31])
    } finally {
      localeLowerCase.mockRestore()
    }
  })

  it('only asks the server for inactive data when the filter needs it', () => {
    expect(shouldIncludeInactive('active')).toBe(false)
    expect(shouldIncludeInactive('all')).toBe(true)
    expect(shouldIncludeInactive('inactive')).toBe(true)
  })
})

describe('create ChoiceSet picker authorization', () => {
  it.each(['loading', 'error'] as const)(
    'fails closed during %s without clearing the raw draft',
    (status) => {
      const picker = deriveParameterChoiceSetPickerState({
        rawCode: 'equipment_mode',
        authorizedCode: 'equipment_mode',
        sets: [equipmentMode],
        status,
        refreshing: status === 'loading',
      })

      expect(picker.rawCode).toBe('equipment_mode')
      expect(picker.selectionReady).toBe(false)
      expect(picker.options).toEqual([
        { code: 'equipment_mode', label: 'Equipment mode', is_active: true },
      ])
    },
  )

  it('reports a successful empty registry and keeps selection unavailable', () => {
    const picker = deriveParameterChoiceSetPickerState({
      rawCode: '',
      authorizedCode: null,
      sets: [],
      status: 'success',
      refreshing: false,
    })

    expect(picker.empty).toBe(true)
    expect(picker.selectionReady).toBe(false)
  })

  it('allows binding an active set even when it currently has zero active options', () => {
    const emptyActiveSet = {
      ...equipmentMode,
      option_count: 0,
      active_option_count: 0,
    }
    const picker = deriveParameterChoiceSetPickerState({
      rawCode: 'equipment_mode',
      authorizedCode: authorizeParameterChoiceSet('equipment_mode'),
      sets: [emptyActiveSet],
      status: 'success',
      refreshing: false,
    })

    expect(picker.selectedActive).toBe(true)
    expect(picker.selectionReady).toBe(true)
  })

  it.each(['picker-open', 'window-focus'])(
    'revokes a set deactivated during %s and requires explicit re-selection',
    () => {
      const rawDraft = 'equipment_mode'
      const authorized = authorizeParameterChoiceSet(rawDraft)
      const revoked = reconcileParameterChoiceSetAuthorization(
        authorized,
        rawDraft,
        [],
      )
      const afterDeactivation = deriveParameterChoiceSetPickerState({
        rawCode: rawDraft,
        authorizedCode: revoked,
        sets: [],
        status: 'success',
        refreshing: false,
      })
      const afterReactivationWithoutReselection = deriveParameterChoiceSetPickerState({
        rawCode: rawDraft,
        authorizedCode: revoked,
        sets: [equipmentMode],
        status: 'success',
        refreshing: false,
      })

      expect(afterDeactivation.rawCode).toBe(rawDraft)
      expect(afterDeactivation.selectedActive).toBe(false)
      expect(afterDeactivation.selectionReady).toBe(false)
      expect(afterReactivationWithoutReselection.selectionReady).toBe(false)
      expect(
        deriveParameterChoiceSetPickerState({
          rawCode: rawDraft,
          authorizedCode: authorizeParameterChoiceSet(rawDraft),
          sets: [equipmentMode],
          status: 'success',
          refreshing: false,
        }).selectionReady,
      ).toBe(true)
    },
  )
})
