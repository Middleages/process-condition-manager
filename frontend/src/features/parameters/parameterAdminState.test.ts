import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import type { CategoryOut, ParameterOut } from '@/api/types'

import {
  canApplyCsvImport,
  csvImportReducer,
  deriveParameterRegistryRoute,
  getExistingParameterDetailPresentation,
  initialCsvImportState,
  invalidateParameterAdminQueries,
  parameterEditorSessionReducer,
  selectFreshParameterForHydration,
  startParameterEditorSession,
} from './parameterAdminState'

const categories: CategoryOut[] = [
  {
    id: 1,
    code: 'photo',
    display_name: 'Photo',
    sort_order: 0,
    is_active: true,
  },
]

const choiceParameter: ParameterOut = {
  id: 42,
  code: 'tone',
  display_name: 'Tone',
  description: 'original',
  value_type: 'choice',
  category_id: 1,
  unit: null,
  min_value: null,
  max_value: null,
  choice_set: {
    code: 'equipment_mode',
    display_name: 'Equipment mode',
    description: null,
    is_active: true,
    version: 1,
    option_count: 1,
    active_option_count: 1,
    parameter_usage_count: 1,
    profile_usage_fields: [],
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-14T00:00:00Z',
  },
  sort_order: 0,
  is_active: true,
}

describe('deriveParameterRegistryRoute', () => {
  it('waits for categories before repairing a restorable URL', () => {
    const current = new URLSearchParams(
      'query=etch&category=missing&type=nope&active=broken&edit=042&extra=drop',
    )

    const pending = deriveParameterRegistryRoute(current, null)

    expect(pending.state.category).toBe('missing')
    expect(pending.repair).toBeNull()
  })

  it('returns a canonical replace target without discarding valid list context', () => {
    const current = new URLSearchParams(
      'query=etch&category=missing&type=nope&active=broken&edit=042&extra=drop',
    )

    const resolved = deriveParameterRegistryRoute(current, categories)

    expect(resolved.state).toMatchObject({
      query: 'etch',
      category: null,
      type: null,
      active: 'active',
      edit: { kind: 'existing', id: 42 },
    })
    expect(resolved.repair?.toString()).toBe('query=etch&edit=42')
  })

  it('does not repair an already canonical URL', () => {
    const current = new URLSearchParams('query=etch&category=photo&active=all&edit=new')

    expect(deriveParameterRegistryRoute(current, categories).repair).toBeNull()
  })
})

describe('parameter editor session', () => {
  it('waits for a successful post-mount detail response and rejects a late old target', () => {
    const target = { kind: 'existing' as const, id: 42 }
    const cached = selectFreshParameterForHydration(target, {
      data: choiceParameter,
      isFetchedAfterMount: false,
      isSuccess: true,
    })
    const failedRefetch = selectFreshParameterForHydration(target, {
      data: choiceParameter,
      isFetchedAfterMount: true,
      isSuccess: false,
    })
    const fresh = selectFreshParameterForHydration(target, {
      data: { ...choiceParameter, display_name: 'Fresh' },
      isFetchedAfterMount: true,
      isSuccess: true,
    })
    const lateOldTarget = selectFreshParameterForHydration(
      { kind: 'existing', id: 43 },
      {
        data: choiceParameter,
        isFetchedAfterMount: true,
        isSuccess: true,
      },
    )

    expect(cached).toBeNull()
    expect(failedRefetch).toBeNull()
    expect(fresh?.display_name).toBe('Fresh')
    expect(lateOldTarget).toBeNull()
  })

  it('hydrates an edit target once and never overwrites a changed draft on refetch', () => {
    const initial = startParameterEditorSession({ kind: 'existing', id: 42 })
    const hydrated = parameterEditorSessionReducer(initial, {
      type: 'hydrate',
      parameter: choiceParameter,
    })
    const changed = parameterEditorSessionReducer(hydrated, {
      type: 'change-field',
      field: 'displayName',
      value: 'Draft name',
    })
    const refetched = parameterEditorSessionReducer(changed, {
      type: 'hydrate',
      parameter: { ...choiceParameter, display_name: 'Refetched' },
    })

    expect(refetched.form.displayName).toBe('Draft name')
    expect(refetched.original?.display_name).toBe('Tone')
  })

  it('has no partial option retry branch and keeps hydrated error presentation simple', () => {
    const initial = parameterEditorSessionReducer(
      startParameterEditorSession({ kind: 'existing', id: 42 }),
      { type: 'hydrate', parameter: choiceParameter },
    )

    expect(initial).not.toHaveProperty('optionsRetry')
    expect(getExistingParameterDetailPresentation(initial, true)).toEqual({
      kind: 'editor',
      refetchError: true,
    })
    expect(
      getExistingParameterDetailPresentation(
        startParameterEditorSession({ kind: 'existing', id: 42 }),
        true,
      ),
    ).toEqual({ kind: 'fatal-error' })
  })
})

describe('CSV import state machine', () => {
  const dryRun = {
    created_count: 1,
    updated_count: 0,
    error_count: 1,
    rows: [
      { line: 2, code: 'good', action: 'create' as const, message: null },
      { line: 3, code: 'bad', action: 'error' as const, message: 'invalid' },
    ],
  }

  it('clears stale preview results whenever CSV text changes', () => {
    const previewed = csvImportReducer(
      csvImportReducer(initialCsvImportState, { type: 'edit', csvText: 'first' }),
      { type: 'preview-succeeded', submittedCsvText: 'first', result: dryRun },
    )

    const edited = csvImportReducer(previewed, { type: 'edit', csvText: 'second' })

    expect(edited).toEqual({
      csvText: 'second',
      preview: null,
      previewCsvText: null,
      applied: false,
    })
    expect(canApplyCsvImport(edited)).toBe(false)
  })

  it('enables apply only for a preview with a create or update and retains error rows', () => {
    const previewed = csvImportReducer(
      csvImportReducer(initialCsvImportState, { type: 'edit', csvText: 'csv' }),
      { type: 'preview-succeeded', submittedCsvText: 'csv', result: dryRun },
    )

    expect(canApplyCsvImport(previewed)).toBe(true)
    expect(previewed.preview?.rows.find((row) => row.action === 'error')).toMatchObject({
      line: 3,
      code: 'bad',
    })

    const applied = csvImportReducer(previewed, {
      type: 'apply-succeeded',
      submittedCsvText: 'csv',
      result: dryRun,
    })
    expect(applied.applied).toBe(true)
  })

  it('ignores delayed preview and apply responses after the submitted text changes', () => {
    const first = csvImportReducer(initialCsvImportState, { type: 'edit', csvText: 'first' })
    const edited = csvImportReducer(first, { type: 'edit', csvText: 'second' })

    expect(
      csvImportReducer(edited, {
        type: 'preview-succeeded',
        submittedCsvText: 'first',
        result: dryRun,
      }),
    ).toEqual(edited)
    expect(
      csvImportReducer(edited, {
        type: 'apply-succeeded',
        submittedCsvText: 'first',
        result: dryRun,
      }),
    ).toEqual(edited)
  })
})

describe('parameter mutation cache invalidation', () => {
  it('invalidates parameter, category, ChoiceSet list, and ChoiceSet summary data', async () => {
    const client = new QueryClient()
    client.setQueryData(['parameters', false], [choiceParameter])
    client.setQueryData(['parameter-categories', true], categories)
    client.setQueryData(['choice-sets', 'list', false], [choiceParameter.choice_set])
    client.setQueryData(['choice-sets', 'summary', 'equipment_mode'], choiceParameter.choice_set)

    await invalidateParameterAdminQueries(client)

    for (const key of [
      ['parameters', false],
      ['parameter-categories', true],
      ['choice-sets', 'list', false],
      ['choice-sets', 'summary', 'equipment_mode'],
    ] as const) {
      expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(true)
    }
  })
})
