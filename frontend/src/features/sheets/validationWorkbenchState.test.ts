import { describe, expect, it, vi } from 'vitest'

import type { ValidationIssuePayload } from '@/shared/domain/validation'

import {
  VALIDATION_WORKBENCH_DEFAULT_HEIGHT,
  VALIDATION_WORKBENCH_MAX_HEIGHT,
  VALIDATION_WORKBENCH_MIN_HEIGHT,
  clampValidationWorkbenchHeight,
  createValidationWorkbenchState,
  enrichValidationIssues,
  filterValidationWorkbenchIssues,
  handleValidationTileActivationKey,
  isValidationTileActivationKey,
  reduceValidationWorkbenchState,
  resolveValidationDefinitionAvailability,
  resolveValidationIssueNavigation,
  shouldAutoOpenValidationWorkbench,
  shouldMountValidationWorkbench,
} from './validationWorkbenchState'

const columns = [
  {
    key: 'amount',
    headerName: '노광량',
    valueType: 'number' as const,
    categoryCode: 'process',
    choiceSetCode: null,
    choiceSetVersion: null,
  },
  {
    key: 'equipment',
    headerName: '장비',
    valueType: 'text' as const,
    categoryCode: 'equipment',
    choiceSetCode: null,
    choiceSetVersion: null,
  },
]
const rows = [
  {
    id: '11',
    layerKey: 'L1',
    stepSeq: '10',
    layerId: 'ETCH',
    layerLabel: 'ETCH (10)',
    conditionLabel: 'POR',
    isPor: true,
    values: { amount: '7', equipment: null },
  },
]

describe('validation workbench lifecycle and local interaction state', () => {
  it('mounts only for effective issues or a successful explicit validation in this session', () => {
    expect(shouldMountValidationWorkbench([], false)).toBe(false)
    expect(shouldMountValidationWorkbench([issue('required', 'error')], false)).toBe(true)
    expect(shouldMountValidationWorkbench([], true)).toBe(true)
  })

  it('auto-opens only for a first issue while no other workbench mode is active', () => {
    expect(shouldAutoOpenValidationWorkbench(0, 1, false)).toBe(true)
    expect(shouldAutoOpenValidationWorkbench(0, 1, true)).toBe(false)
    expect(shouldAutoOpenValidationWorkbench(1, 2, false)).toBe(false)
    expect(shouldAutoOpenValidationWorkbench(0, 0, false)).toBe(false)
  })

  it('toggles error and warning filters independently and reports the truthful subset', () => {
    const issues = enrichValidationIssues(
      [issue('required', 'error'), issue('choice_inactive', 'warning', 'equipment')],
      columns,
      rows,
    )
    const initial = createValidationWorkbenchState()
    const withoutErrors = reduceValidationWorkbenchState(initial, {
      type: 'toggle-severity',
      severity: 'error',
    })
    expect(filterValidationWorkbenchIssues(issues, withoutErrors)).toEqual([issues[1]])

    const withoutEither = reduceValidationWorkbenchState(withoutErrors, {
      type: 'toggle-severity',
      severity: 'warning',
    })
    expect(filterValidationWorkbenchIssues(issues, withoutEither)).toEqual([])
  })

  it('clamps the shared workbench height constants to the declared bounds', () => {
    const initial = createValidationWorkbenchState()

    expect(initial).toEqual({
      showErrors: true,
      showWarnings: true,
      selectedIssueKey: null,
    })
    expect(clampValidationWorkbenchHeight(VALIDATION_WORKBENCH_DEFAULT_HEIGHT)).toBe(
      VALIDATION_WORKBENCH_DEFAULT_HEIGHT,
    )
    expect(clampValidationWorkbenchHeight(100_000)).toBe(VALIDATION_WORKBENCH_MAX_HEIGHT)
    expect(clampValidationWorkbenchHeight(-100_000)).toBe(VALIDATION_WORKBENCH_MIN_HEIGHT)
  })

  it('recognizes only Enter and Space as explicit tile activation keys', () => {
    expect(isValidationTileActivationKey('Enter')).toBe(true)
    expect(isValidationTileActivationKey(' ')).toBe(true)
    expect(isValidationTileActivationKey('ArrowDown')).toBe(false)
  })

  it('prevents native activation before ignoring repeated Enter or Space keydown events', () => {
    const preventDefault = vi.fn()
    const activate = vi.fn()

    handleValidationTileActivationKey(' ', true, preventDefault, activate)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(activate).not.toHaveBeenCalled()
  })

  it('expands only the selected issue and collapses it on the next activation', () => {
    const initial = createValidationWorkbenchState()
    const selected = reduceValidationWorkbenchState(initial, {
      type: 'select-issue',
      key: '11:amount:required',
    })
    expect(selected.selectedIssueKey).toBe('11:amount:required')
    expect(
      reduceValidationWorkbenchState(selected, {
        type: 'select-issue',
        key: '11:amount:required',
      }).selectedIssueKey,
    ).toBeNull()
  })
})

describe('validation issue enrichment and domain navigation', () => {
  it('joins row, column, current value, and safe mapped guidance without fixed parameter codes', () => {
    const [enriched] = enrichValidationIssues([issue('required', 'error')], columns, rows)

    expect(enriched).toEqual(
      expect.objectContaining({
        key: '11:amount:required',
        severityLabel: '오류',
        layerLabel: 'ETCH (10)',
        conditionLabel: 'POR',
        parameterName: '노광량',
        currentValue: '7',
        guidance: '노광량 값을 입력해 주세요.',
        categoryCode: 'process',
      }),
    )
    expect(enriched?.accessibleDescription).toContain('오류')
    expect(enriched?.accessibleDescription).toContain('노광량 값을 입력해 주세요.')
  })

  it('uses the safe fallback for an unknown code and never renders raw details', () => {
    const unknown = {
      ...issue('future_server_code', 'error'),
      details: { exception: 'SQL stack secret', pattern: '(raw-server-pattern)' },
    }
    const logUnknownCode = vi.fn()
    const [enriched] = enrichValidationIssues(
      [unknown, { ...unknown, key: '11:amount:future_server_code:duplicate' }],
      columns,
      rows,
      logUnknownCode,
    )

    expect(enriched?.guidance).toBe('입력 조건을 확인해 주세요.')
    expect(enriched?.accessibleDescription).not.toContain('SQL stack secret')
    expect(enriched?.accessibleDescription).not.toContain('raw-server-pattern')
    expect(logUnknownCode).toHaveBeenCalledOnce()
    expect(logUnknownCode).toHaveBeenCalledWith('future_server_code')
    expect(logUnknownCode.mock.calls.flat()).not.toContain(unknown.details)
  })

  it('reveals a hidden category before navigation but jumps directly for a visible target', () => {
    const hidden = resolveValidationIssueNavigation(
      issue('required', 'error', 'equipment'),
      columns,
      rows,
      'process',
    )
    expect(hidden).toEqual({
      kind: 'reveal-category',
      categoryCode: 'equipment',
      target: { conditionId: '11', parameterCode: 'equipment' },
    })

    expect(
      resolveValidationIssueNavigation(issue('required', 'error'), columns, rows, 'process'),
    ).toEqual({ kind: 'direct', target: { conditionId: '11', parameterCode: 'amount' } })
  })

  it('fails closed for a missing row or column instead of issuing a stale grid command', () => {
    expect(
      resolveValidationIssueNavigation(
        { ...issue('required', 'error'), condition_id: 999 },
        columns,
        rows,
        null,
      ),
    ).toEqual({ kind: 'missing-target' })
    expect(
      resolveValidationIssueNavigation(
        issue('required', 'error', 'missing'),
        columns,
        rows,
        null,
      ),
    ).toEqual({ kind: 'missing-target' })
  })
})

describe('validation definition availability', () => {
  it('treats an error-free project load and ChoiceSet transitions as pending, not unavailable', () => {
    expect(
      resolveValidationDefinitionAvailability({
        projectAvailable: false,
        projectError: null,
        resources: [],
        definitionsAvailable: false,
      }),
    ).toBe('pending')
    expect(
      resolveValidationDefinitionAvailability({
        projectAvailable: true,
        projectError: null,
        resources: [{ loading: true, isStale: true, error: null }],
        definitionsAvailable: false,
      }),
    ).toBe('pending')
    expect(
      resolveValidationDefinitionAvailability({
        projectAvailable: true,
        projectError: null,
        resources: [{ loading: false, isStale: true, error: null }],
        definitionsAvailable: false,
      }),
    ).toBe('pending')
  })

  it('keeps real metadata, ChoiceSet, and adapter failures unavailable', () => {
    expect(
      resolveValidationDefinitionAvailability({
        projectAvailable: false,
        projectError: new Error('metadata unavailable'),
        resources: [],
        definitionsAvailable: false,
      }),
    ).toBe('unavailable')
    expect(
      resolveValidationDefinitionAvailability({
        projectAvailable: true,
        projectError: null,
        resources: [{ loading: false, isStale: true, error: 'choice unavailable' }],
        definitionsAvailable: false,
      }),
    ).toBe('unavailable')
    expect(
      resolveValidationDefinitionAvailability({
        projectAvailable: true,
        projectError: null,
        resources: [],
        definitionsAvailable: false,
      }),
    ).toBe('unavailable')
  })
})

function issue(
  code: string,
  severity: 'error' | 'warning',
  parameterCode = 'amount',
): ValidationIssuePayload {
  return {
    key: `11:${parameterCode}:${code}`,
    code,
    rule_code: null,
    rule_version: null,
    severity,
    condition_id: 11,
    layer_key: 'L1',
    parameter_code: parameterCode,
    details: {},
  }
}
