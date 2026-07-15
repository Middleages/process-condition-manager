import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectValidationOut } from '@/api/types'
import type { ValidationInput } from '@/shared/domain/validation'

import { applyDirtyToRows, useEditStore } from './editStore'
import {
  createSheetValidationController,
  deriveProvisionalValidation,
  type PersistenceSnapshot,
  type SheetValidationContext,
} from './useSheetValidation'
import source from './useSheetValidation.ts?raw'

describe('sheet validation controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces multiple durable successes into one request 500ms after persistence becomes idle', async () => {
    const validate = vi.fn(async () => validationResult('sha256:a'))
    const runtime = harness(validate)
    runtime.controller.publish(runtime.context())

    runtime.persistence.persistedGeneration += 1
    runtime.controller.publish(runtime.context())
    await vi.advanceTimersByTimeAsync(300)
    runtime.persistence.persistedGeneration += 1
    runtime.controller.publish(runtime.context())
    await vi.advanceTimersByTimeAsync(499)
    expect(validate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(validate).toHaveBeenCalledTimes(1)
    expect(validate).toHaveBeenCalledWith(7, expect.any(AbortSignal))
  })

  it('starts the idle window only after persistence becomes durably idle', async () => {
    const validate = vi.fn(async () => validationResult('sha256:a'))
    const runtime = harness(validate)
    runtime.controller.publish(runtime.context())
    runtime.persistence.persistedGeneration += 1
    runtime.persistence.dirtyCount = 1
    runtime.persistence.saveStatus = 'saving'
    runtime.controller.publish(runtime.context())

    await vi.advanceTimersByTimeAsync(2_000)
    expect(validate).not.toHaveBeenCalled()

    runtime.persistence.dirtyCount = 0
    runtime.persistence.saveStatus = 'saved'
    runtime.controller.publish(runtime.context())
    await vi.advanceTimersByTimeAsync(499)
    expect(validate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(validate).toHaveBeenCalledOnce()
  })

  it('explicit validation waits for queued/autosave persistence and uses the resulting generation', async () => {
    const validation = deferred<ProjectValidationOut>()
    const validate = vi.fn(() => validation.promise)
    const persistence = deferred<boolean>()
    const runtime = harness(validate, () => persistence.promise)
    runtime.persistence.dirtyCount = 1
    runtime.persistence.writeBusy = true
    runtime.persistence.saveStatus = 'saving'
    runtime.controller.publish(runtime.context())

    const explicit = runtime.controller.explicitlyValidate()
    await Promise.resolve()
    expect(runtime.controller.getState().serverConfirmation).toBe('waiting-for-persistence')
    expect(validate).not.toHaveBeenCalled()

    runtime.persistence.dirtyCount = 0
    runtime.persistence.writeBusy = false
    runtime.persistence.saveStatus = 'saved'
    runtime.persistence.persistedGeneration += 1
    persistence.resolve(true)
    await Promise.resolve()
    expect(validate).toHaveBeenCalledOnce()

    validation.resolve(validationResult('sha256:a'))
    await expect(explicit).resolves.toBe(true)
    expect(runtime.controller.getState().authoritativeConfirmation?.persistedGeneration).toBe(1)
  })

  it('blocks explicit validation after persistence failure with exact Korean guidance', async () => {
    const validate = vi.fn(async () => validationResult('sha256:a'))
    const runtime = harness(validate, async () => false)
    runtime.persistence.dirtyCount = 1
    runtime.persistence.saveStatus = 'error'
    runtime.controller.publish(runtime.context())

    await expect(runtime.controller.explicitlyValidate()).resolves.toBe(false)

    expect(validate).not.toHaveBeenCalled()
    expect(runtime.controller.getState().serverFailure).toBe('저장 후 검증해 주세요.')
  })

  it.each(['project', 'mount authority', 'definition authority', 'persisted generation'] as const)(
    'ignores a response after %s changes',
    async (change) => {
      const pending = deferred<ProjectValidationOut>()
      const validate = vi.fn(() => pending.promise)
      const runtime = harness(validate)
      runtime.controller.publish(runtime.context())
      const request = runtime.controller.explicitlyValidate()
      await Promise.resolve()

      if (change === 'project') {
        runtime.projectId = 8
        runtime.mountAuthority = Symbol('project-8')
      } else if (change === 'mount authority') {
        runtime.mountAuthority = Symbol('remount')
      } else if (change === 'definition authority') {
        runtime.definitionAuthority = Symbol('definitions-b')
      } else {
        runtime.persistence.persistedGeneration += 1
      }
      runtime.controller.publish(runtime.context())
      pending.resolve(validationResult('sha256:a'))

      await expect(request).resolves.toBe(false)
      expect(runtime.controller.getState().authoritativeSummary).toBeNull()
    },
  )

  it('attempts abort on supersession and unmount even though adoption is independently fenced', async () => {
    const requests: Array<{ signal: AbortSignal; result: ReturnType<typeof deferred<ProjectValidationOut>> }> = []
    const validate = vi.fn((_projectId: number, signal?: AbortSignal) => {
      const result = deferred<ProjectValidationOut>()
      requests.push({ signal: signal!, result })
      return result.promise
    })
    const runtime = harness(validate)
    runtime.controller.publish(runtime.context())
    const first = runtime.controller.explicitlyValidate()
    await Promise.resolve()

    runtime.persistence.persistedGeneration += 1
    runtime.controller.publish(runtime.context())
    expect(requests[0]?.signal.aborted).toBe(true)
    requests[0]?.result.resolve(validationResult('sha256:a'))
    await expect(first).resolves.toBe(false)

    const second = runtime.controller.explicitlyValidate()
    await Promise.resolve()
    runtime.controller.dispose()
    expect(requests[1]?.signal.aborted).toBe(true)
    requests[1]?.result.resolve(validationResult('sha256:a'))
    await expect(second).resolves.toBe(false)
  })

  it('refetches Sheet on basis mismatch before any adoption', async () => {
    const refetched = deferred<void>()
    const runtime = harness(async () => validationResult('sha256:b'))
    runtime.refetchSheet = vi.fn(() => refetched.promise)
    runtime.controller.publish(runtime.context())

    const request = runtime.controller.explicitlyValidate()
    await Promise.resolve()
    await Promise.resolve()
    expect(runtime.refetchSheet).toHaveBeenCalledOnce()
    expect(runtime.controller.getState().authoritativeSummary).toBeNull()

    refetched.resolve()
    await expect(request).resolves.toBe(false)
    expect(runtime.controller.getState().serverFailure).toBe(
      '검증 규칙을 불러오지 못했습니다. 관리자에게 확인을 요청해 주세요.',
    )
  })

  it('cannot adopt a basis-mismatched response after refetch changes authority', async () => {
    const refetched = deferred<void>()
    const runtime = harness(async () => validationResult('sha256:b'))
    runtime.refetchSheet = vi.fn(() => refetched.promise)
    runtime.controller.publish(runtime.context())
    const request = runtime.controller.explicitlyValidate()
    await Promise.resolve()
    await Promise.resolve()

    runtime.definitionAuthority = Symbol('refetched-definitions')
    runtime.basisHash = 'sha256:b'
    runtime.controller.publish(runtime.context())
    refetched.resolve()

    await expect(request).resolves.toBe(false)
    expect(runtime.controller.getState().authoritativeSummary).toBeNull()
  })

  it('preserves the latest successful authoritative result across a later network failure', async () => {
    const validate = vi
      .fn<(projectId: number, signal?: AbortSignal) => Promise<ProjectValidationOut>>()
      .mockResolvedValueOnce(validationResult('sha256:a', 2))
      .mockRejectedValueOnce(new Error('offline'))
    const runtime = harness(validate)
    runtime.controller.publish(runtime.context())

    await expect(runtime.controller.explicitlyValidate()).resolves.toBe(true)
    const successfulIssues = runtime.controller.getState().authoritativeIssues
    const successfulConfirmation = runtime.controller.getState().authoritativeConfirmation
    await expect(runtime.controller.retry()).resolves.toBe(false)

    expect(runtime.controller.getState()).toEqual(
      expect.objectContaining({
        authoritativeIssues: successfulIssues,
        authoritativeSummary: { error_count: 2, warning_count: 0 },
        authoritativeConfirmation: successfulConfirmation,
        serverConfirmation: 'failed',
        serverFailure: '최신 상태 확인 실패 · 다시 시도',
      }),
    )
  })

  it('marks a newly persisted generation unconfirmed immediately while retaining the last payload', async () => {
    const validate = vi.fn(async () => validationResult('sha256:a', 1))
    const runtime = harness(validate)
    runtime.controller.publish(runtime.context())
    await expect(runtime.controller.explicitlyValidate()).resolves.toBe(true)
    const confirmed = runtime.controller.getState()

    runtime.persistence.persistedGeneration += 1
    runtime.controller.publish(runtime.context())

    expect(runtime.controller.getState()).toEqual(
      expect.objectContaining({
        authoritativeIssues: confirmed.authoritativeIssues,
        authoritativeSummary: confirmed.authoritativeSummary,
        authoritativeConfirmation: confirmed.authoritativeConfirmation,
        serverConfirmation: 'idle',
        serverFailure: null,
      }),
    )
    expect(validate).toHaveBeenCalledOnce()
  })

  it('reports only unavailable definitions as failure and schedules ready definition changes', async () => {
    const validate = vi.fn(async () => validationResult('sha256:a', 1))
    const runtime = harness(validate)
    runtime.controller.publish(runtime.context())
    await expect(runtime.controller.explicitlyValidate()).resolves.toBe(true)
    const confirmed = runtime.controller.getState()

    runtime.definitionsReady = false
    runtime.definitionAuthority = Symbol('definitions-unavailable')
    runtime.controller.publish(runtime.context())
    expect(runtime.controller.getState()).toEqual(
      expect.objectContaining({
        authoritativeIssues: confirmed.authoritativeIssues,
        authoritativeSummary: confirmed.authoritativeSummary,
        authoritativeConfirmation: confirmed.authoritativeConfirmation,
        serverConfirmation: 'idle',
        serverFailure: '검증 규칙을 불러오지 못했습니다. 관리자에게 확인을 요청해 주세요.',
      }),
    )

    await vi.advanceTimersByTimeAsync(500)
    expect(validate).toHaveBeenCalledOnce()

    runtime.definitionsReady = true
    runtime.definitionAuthority = Symbol('definitions-ready')
    runtime.controller.publish(runtime.context())
    expect(runtime.controller.getState()).toEqual(
      expect.objectContaining({ serverConfirmation: 'idle', serverFailure: null }),
    )

    await vi.advanceTimersByTimeAsync(500)
    expect(validate).toHaveBeenCalledTimes(2)
  })
})

describe('provisional display evaluation and hook wiring', () => {
  it('re-evaluates the committed display buffer as accepted edit and paste generations advance', () => {
    useEditStore.getState().clearAll()
    const baseRows = [displayRow('server')]
    const beforeEdit = useEditStore.getState().displayGeneration

    useEditStore.getState().setCell({ conditionId: '1', parameterCode: 'amount', value: null })
    const editedRows = applyDirtyToRows(baseRows, useEditStore.getState().dirtyCells)
    expect(useEditStore.getState().displayGeneration).toBe(beforeEdit + 1)
    expect(deriveProvisionalValidation(requiredInput(), editedRows).issues).toHaveLength(1)

    useEditStore.getState().clearAll()
    const beforePaste = useEditStore.getState().displayGeneration
    useEditStore.getState().setCells([
      { conditionId: '1', parameterCode: 'amount', value: null },
    ])
    const pastedRows = applyDirtyToRows(baseRows, useEditStore.getState().dirtyCells)
    expect(useEditStore.getState().displayGeneration).toBe(beforePaste + 1)
    expect(deriveProvisionalValidation(requiredInput(), pastedRows).issues).toHaveLength(1)
    useEditStore.getState().clearAll()
  })

  it('keeps local issues updating independently while server confirmation is in flight or failed', async () => {
    const pending = deferred<ProjectValidationOut>()
    const runtime = harness(() => pending.promise)
    runtime.controller.publish(runtime.context())
    const request = runtime.controller.explicitlyValidate()
    await Promise.resolve()
    expect(runtime.controller.getState().serverConfirmation).toBe('validating')

    expect(deriveProvisionalValidation(requiredInput(), [displayRow(null)]).summary).toEqual({
      error_count: 1,
      warning_count: 0,
    })
    expect(deriveProvisionalValidation(requiredInput(), [displayRow('saved locally')]).summary).toEqual({
      error_count: 0,
      warning_count: 0,
    })

    pending.reject(new Error('offline'))
    await expect(request).resolves.toBe(false)
    expect(runtime.controller.getState().serverConfirmation).toBe('failed')
    expect(deriveProvisionalValidation(requiredInput(), [displayRow(null)]).issues).toHaveLength(1)
  })

  it('publishes committed authority in an isomorphic layout effect and disposes on cleanup', () => {
    expect(source).toContain('withValidationDisplayRows')
    expect(source).toMatch(/useMemo\([\s\S]*?displayGeneration/)
    expect(source).toContain('useIsomorphicLayoutEffect')
    expect(source).toMatch(
      /useIsomorphicLayoutEffect\(\(\) => \{[\s\S]*?controller\.publish\(context\)/,
    )
    expect(source).toContain('controller.dispose()')
    expect(source).not.toContain('controller.publish({\n')
  })

  it('fails closed only for adapter mismatches and propagates unrelated runtime faults', () => {
    expect(deriveProvisionalValidation(requiredInput(), [])).toEqual(
      expect.objectContaining({ status: 'unavailable', summary: null, issues: [] }),
    )

    const unexpectedRows = new Proxy([displayRow('value')], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error('unexpected display fault')
        return Reflect.get(target, property, receiver)
      },
    })
    expect(() => deriveProvisionalValidation(requiredInput(), unexpectedRows)).toThrow(
      'unexpected display fault',
    )
  })
})

function harness(
  validate: (projectId: number, signal?: AbortSignal) => Promise<ProjectValidationOut>,
  waitForPersistence: () => Promise<boolean> = async () => true,
) {
  const controller = createSheetValidationController({ validate })
  const persistence: PersistenceSnapshot = {
    dirtyCount: 0,
    writeBusy: false,
    saveStatus: 'saved',
    persistedGeneration: 0,
  }
  const runtime = {
    controller,
    persistence,
    projectId: 7,
    mountAuthority: Symbol('sheet-mount'),
    definitionAuthority: Symbol('definitions-a'),
    definitionsReady: true,
    basisHash: 'sha256:a',
    refetchSheet: vi.fn(async () => undefined) as () => Promise<void>,
    context(): SheetValidationContext {
      return {
        projectId: runtime.projectId,
        mountAuthority: runtime.mountAuthority,
        definitionAuthority: runtime.definitionAuthority,
        validationBasisHash: runtime.basisHash,
        definitionsReady: runtime.definitionsReady,
        persistedGeneration: persistence.persistedGeneration,
        persistenceIdle:
          persistence.dirtyCount === 0 &&
          !persistence.writeBusy &&
          persistence.saveStatus !== 'saving' &&
          persistence.saveStatus !== 'error',
        getPersistenceSnapshot: () => ({ ...persistence }),
        waitForPersistence,
        refetchSheet: () => runtime.refetchSheet(),
      }
    },
  }
  return runtime
}

function validationResult(
  basisHash: string,
  errorCount = 0,
): ProjectValidationOut {
  return {
    summary: { error_count: errorCount, warning_count: 0 },
    issues: Array.from({ length: errorCount }, (_, index) => ({
      key: `${index + 1}:amount:required`,
      code: 'required',
      rule_code: null,
      rule_version: null,
      severity: 'error' as const,
      condition_id: index + 1,
      layer_key: 'L1',
      parameter_code: 'amount',
      details: {},
    })),
    evaluated_at: '2026-07-15T00:00:00Z',
    basis_hash: basisHash,
    rule_versions: {},
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function requiredInput(): ValidationInput {
  return {
    context: { project_id: 7, line_id: 'LINE', process_id: 'PROC' },
    parameters: [
      {
        code: 'amount',
        display_name: '노광량',
        value_type: 'text',
        required: true,
        pattern: null,
        pattern_hint: null,
        min_value: null,
        max_value: null,
        choice_set_code: null,
        choices: [],
        sort_order: 0,
      },
    ],
    layers: [
      {
        key: 'L1',
        layer_id: 'L1',
        step_seq: '10',
        eqp_type: null,
        area_name: null,
        sort_order: 0,
        conditions: [
          {
            id: 1,
            label: 'POR',
            condition_index: 0,
            is_por: true,
            values: { amount: 'server' },
          },
        ],
      },
    ],
    rules: [],
  }
}

function displayRow(value: string | null) {
  return {
    id: '1',
    layerKey: 'L1',
    layerLabel: 'L1 (10)',
    conditionLabel: 'POR',
    isPor: true,
    values: { amount: value },
    layerSortOrder: 0,
    conditionIndex: 0,
  }
}
