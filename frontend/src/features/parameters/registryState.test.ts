import { describe, expect, it, vi } from 'vitest'

import {
  canonicalizeParameterRegistryState,
  filterParameterRegistry,
  parseParameterRegistrySearch,
  serializeParameterRegistrySearch,
  shouldIncludeInactive,
} from './registryState'

import type { CategoryOut, ParameterOut } from '@/api/types'

const categories: CategoryOut[] = [
  { id: 10, code: 'photo', display_name: 'Photolithography', sort_order: 0, is_active: true },
  { id: 20, code: 'etch', display_name: 'Dry Etch', sort_order: 1, is_active: false },
]

const parameters: ParameterOut[] = [
  {
    id: 31,
    code: 'exposure_dose',
    display_name: 'Exposure Dose',
    description: 'Wafer illumination target',
    value_type: 'number',
    category_id: 10,
    unit: 'mJ',
    min_value: 0,
    max_value: 100,
    sort_order: 0,
    is_active: true,
    options: [],
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
    sort_order: 1,
    is_active: false,
    options: [
      { id: 1, value: 'soft', display_name: 'Soft', sort_order: 0, is_active: true },
    ],
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
    sort_order: 2,
    is_active: true,
    options: [],
  },
]

describe('parameter registry URL state', () => {
  it('uses the active registry defaults', () => {
    expect(parseParameterRegistrySearch(new URLSearchParams())).toEqual({
      query: '',
      category: null,
      type: null,
      active: 'active',
      edit: { kind: 'closed' },
    })
  })

  it('parses new, existing, and invalid edit targets syntactically', () => {
    expect(parseParameterRegistrySearch(new URLSearchParams('edit=new')).edit).toEqual({
      kind: 'new',
    })
    expect(parseParameterRegistrySearch(new URLSearchParams('edit=42')).edit).toEqual({
      kind: 'existing',
      id: 42,
    })
    expect(parseParameterRegistrySearch(new URLSearchParams('edit=0')).edit).toEqual({
      kind: 'invalid',
      raw: '0',
    })
    expect(parseParameterRegistrySearch(new URLSearchParams('edit=abc')).edit).toEqual({
      kind: 'invalid',
      raw: 'abc',
    })
    expect(parseParameterRegistrySearch(new URLSearchParams('edit=1e2')).edit).toEqual({
      kind: 'invalid',
      raw: '1e2',
    })
    expect(
      parseParameterRegistrySearch(
        new URLSearchParams(`edit=${Number.MAX_SAFE_INTEGER + 1}`),
      ).edit,
    ).toEqual({ kind: 'invalid', raw: String(Number.MAX_SAFE_INTEGER + 1) })
  })

  it('canonicalizes a leading-zero positive id during serialization', () => {
    const parsed = parseParameterRegistrySearch(new URLSearchParams('edit=042'))

    expect(parsed.edit).toEqual({ kind: 'existing', id: 42 })
    expect(serializeParameterRegistrySearch(parsed).toString()).toBe('edit=42')
  })

  it('normalizes invalid active and type values while preserving a category until lookup', () => {
    const parsed = parseParameterRegistrySearch(
      new URLSearchParams('query=DOSE&category=missing&type=currency&active=archived'),
    )

    expect(parsed).toMatchObject({
      query: 'DOSE',
      category: 'missing',
      type: null,
      active: 'active',
    })
    expect(canonicalizeParameterRegistryState(parsed, new Set(['photo'])).category).toBeNull()
    expect(
      canonicalizeParameterRegistryState(
        { ...parsed, category: 'photo' },
        new Set(['photo']),
      ).category,
    ).toBe('photo')
  })

  it('serializes only canonical non-default state and preserves invalid edit text', () => {
    const state = parseParameterRegistrySearch(
      new URLSearchParams('query=dose&category=photo&type=number&active=all&edit=bad'),
    )

    expect(serializeParameterRegistrySearch(state).toString()).toBe(
      'query=dose&category=photo&type=number&active=all&edit=bad',
    )
    expect(
      serializeParameterRegistrySearch(
        parseParameterRegistrySearch(new URLSearchParams()),
      ).toString(),
    ).toBe('')
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
  ])('searches %s case-insensitively', (_field, query, ids) => {
    expect(
      filterParameterRegistry(parameters, categories, { ...defaultState, query }).map(
        (parameter) => parameter.id,
      ),
    ).toEqual(ids)
  })

  it('combines category, type, and active predicates', () => {
    expect(
      filterParameterRegistry(parameters, categories, {
        ...defaultState,
        category: 'photo',
        type: 'number',
        active: 'active',
      }).map((parameter) => parameter.id),
    ).toEqual([31])
  })

  it('returns inactive-only results when requested', () => {
    expect(
      filterParameterRegistry(parameters, categories, {
        ...defaultState,
        active: 'inactive',
      }).map((parameter) => parameter.id),
    ).toEqual([18])
  })

  it('preserves backend order while filtering all statuses', () => {
    expect(
      filterParameterRegistry(parameters, categories, {
        ...defaultState,
        active: 'all',
      }).map((parameter) => parameter.id),
    ).toEqual([31, 18, 7])
  })

  it('does not depend on host locale rules for case folding', () => {
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
