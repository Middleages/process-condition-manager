import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Search } from 'lucide-react'
import {
  type FormEvent,
  type ReactNode,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import {
  getApiErrorMessage,
  getApiErrorStatus,
  getExistingProjectId,
} from '@/api/client'
import { getProcess, searchProcesses } from '@/api/processes'
import {
  createProject,
  getBackboneCandidates,
  getProject,
  previewBackbone,
} from '@/api/projects'
import type {
  BackboneCandidateOut,
  MatchOut,
  MatchType,
  ProjectCreate,
  ProcessDetailOut,
  ProcessOut,
} from '@/api/types'
import { Badge } from '@/shared/components/Badge'
import { Button } from '@/shared/components/Button'
import { Field } from '@/shared/components/Field'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { cn } from '@/shared/lib/cn'
import { useUnsavedChanges } from '@/shared/navigation/useUnsavedChanges'

import {
  parseProjectCreateSearch,
  serializeProjectCreateSearch,
  toProjectListHref,
  type ProjectCreateRouteState,
} from './urlState'
import {
  getProjectCreateRouteReconciliation,
  getCreateDisabledReason,
  getManualOverrideDefaultLabel,
  invalidateProjectCreationQueries,
  isWizardInteractionLocked,
  previewFingerprint,
  selectBackbone,
  selectProcess,
  shouldApplyRouteReconciliation,
  toManualOverrides,
  updateManualOverride,
  type CreateDisabledReason,
} from './wizardState'

const STEPS = [
  { index: 1, title: 'Process 확인' },
  { index: 2, title: '백본 선택' },
  { index: 3, title: '매칭 확인 · 프로젝트 정보' },
] as const

const CREATE_DISABLED_MESSAGE: Record<CreateDisabledReason, string> = {
  'process-missing': '먼저 Process를 선택해 주세요.',
  'process-loading': '선택한 Process를 확인하는 중입니다.',
  'process-invalid': '선택한 Process를 확인할 수 없습니다. 다시 선택하거나 재시도해 주세요.',
  'duplicate-process': '이 Process에는 이미 프로젝트가 있어 새로 만들 수 없습니다.',
  'backbone-loading': '선택한 백본을 확인하는 중입니다.',
  'backbone-invalid': '선택한 백본을 사용할 수 없습니다. 다시 선택해 주세요.',
  'preview-loading': '현재 선택으로 매칭 결과를 계산하는 중입니다.',
  'preview-error': '매칭 결과를 확인하지 못했습니다. 다시 시도해 주세요.',
  'preview-stale': '현재 선택과 일치하는 매칭 결과를 기다리는 중입니다.',
  'required-fields': 'Part ID와 프로젝트명을 모두 입력해 주세요.',
  submitting: '프로젝트를 생성하는 중입니다.',
}

interface PreviewResult {
  fingerprint: string
  preview: Awaited<ReturnType<typeof previewBackbone>>
}

interface ProjectCreateSubmission {
  payload: ProjectCreate
  process: Pick<ProcessDetailOut, 'key' | 'line_id' | 'process_id'>
}

export function ProjectCreateWizard({ onCreated }: { onCreated: (projectId: number) => void }) {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const routeState = parseProjectCreateSearch(searchParams)
  const [processQuery, setProcessQuery] = useState('')
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [partId, setPartId] = useState('')
  const [name, setName] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [submitLocked, setSubmitLocked] = useState(false)
  const [createdProjectId, setCreatedProjectId] = useState<number | null>(null)
  const [staleBackboneCleared, setStaleBackboneCleared] = useState(false)
  const submitLockRef = useRef(false)
  const completionStartedRef = useRef(false)
  const reconciledDownstream404Ref = useRef<unknown>(null)
  const appliedRouteReconciliationRef = useRef<string | null>(null)
  const baselineAutomaticSourcesRef = useRef<Record<string, string>>({})
  const previousSelectionRef = useRef({
    processKey: routeState.processKey,
    backboneId: routeState.backboneId,
  })

  useUnsavedChanges({
    when: isDirty,
    message: '작성 중인 프로젝트 정보가 있습니다. 이 페이지를 떠날까요?',
    allowPath: '/projects/new',
  })

  const processResults = useInfiniteQuery({
    queryKey: ['processes', 'picker', processQuery],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      searchProcesses({
        query: processQuery || undefined,
        cursor: pageParam ?? undefined,
        limit: 50,
      }),
    getNextPageParam: (page) => page.next_cursor,
  })
  const processes = processResults.data?.pages.flatMap((page) => page.items) ?? []

  const selectedProcessQuery = useQuery({
    queryKey: ['process', routeState.processKey],
    queryFn: () => getProcess(routeState.processKey as string),
    enabled: routeState.processKey !== null,
  })
  const selectedProcess = selectedProcessQuery.data ?? null
  const processReady =
    selectedProcess !== null && !selectedProcessQuery.isError && !selectedProcess.has_project

  const candidatesQuery = useQuery({
    queryKey: ['backbone-candidates', selectedProcess?.line_id, selectedProcess?.process_id],
    queryFn: () => getBackboneCandidates(selectedProcess!.line_id, selectedProcess!.process_id),
    enabled: processReady,
  })

  const backboneDetailQuery = useQuery({
    queryKey: ['project', routeState.backboneId],
    queryFn: () => getProject(routeState.backboneId as number),
    enabled: processReady && routeState.backboneId !== null,
  })

  const manualOverrides = useMemo(() => toManualOverrides(overrides), [overrides])
  const currentFingerprint = useMemo(
    () => previewFingerprint(routeState.processKey, routeState.backboneId, overrides),
    [overrides, routeState.backboneId, routeState.processKey],
  )
  const baselineFingerprint = useMemo(
    () => previewFingerprint(routeState.processKey, routeState.backboneId, {}),
    [routeState.backboneId, routeState.processKey],
  )
  const explicitBackboneReady =
    routeState.backboneId === null || backboneDetailQuery.isSuccess
  const previewEnabled = processReady && explicitBackboneReady

  const previewQuery = useQuery<PreviewResult>({
    queryKey: ['backbone-preview', currentFingerprint],
    queryFn: async () => ({
      fingerprint: currentFingerprint,
      preview: await previewBackbone({
        line_id: selectedProcess!.line_id,
        process_id: selectedProcess!.process_id,
        backbone_project_id: routeState.backboneId,
        manual_overrides: manualOverrides,
      }),
    }),
    enabled: previewEnabled,
    placeholderData: (previousData) => previousData,
  })

  const createMutation = useMutation({
    mutationFn: (submission: ProjectCreateSubmission) => createProject(submission.payload),
    onSuccess: (project, submission) => {
      void invalidateProjectCreationQueries(queryClient, submission.process)
      setIsDirty(false)
      setCreatedProjectId(project.id)
    },
    onSettled: () => {
      submitLockRef.current = false
      setSubmitLocked(false)
    },
  })
  const interactionLocked = isWizardInteractionLocked({
    submitLatched: submitLocked || submitLockRef.current,
    mutationPending: createMutation.isPending,
    completionPending: createdProjectId !== null,
  })

  useEffect(() => {
    if (createdProjectId === null || isDirty || completionStartedRef.current) return

    completionStartedRef.current = true
    onCreated(createdProjectId)
  }, [createdProjectId, isDirty, onCreated])

  useEffect(() => {
    const previous = previousSelectionRef.current
    if (
      previous.processKey !== routeState.processKey ||
      previous.backboneId !== routeState.backboneId
    ) {
      setOverrides((current) => (Object.keys(current).length === 0 ? current : {}))
      baselineAutomaticSourcesRef.current = {}
      previousSelectionRef.current = {
        processKey: routeState.processKey,
        backboneId: routeState.backboneId,
      }
    }
  }, [routeState.backboneId, routeState.processKey])

  const routeReconciliation =
    createdProjectId === null
      ? getProjectCreateRouteReconciliation({
          routeState,
          processNotFound:
            selectedProcessQuery.isError &&
            getApiErrorStatus(selectedProcessQuery.error) === 404,
          processHasProject: selectedProcess?.has_project === true,
          backboneNotFound:
            processReady &&
            backboneDetailQuery.isError &&
            getApiErrorStatus(backboneDetailQuery.error) === 404,
        })
      : null
  const reconciliationKey = routeReconciliation?.key ?? null
  const reconciliationKind = routeReconciliation?.kind ?? null
  const reconciledStep = routeReconciliation?.routeState.step ?? null
  const reconciledProcessKey = routeReconciliation?.routeState.processKey ?? null
  const reconciledBackboneId = routeReconciliation?.routeState.backboneId ?? null

  useEffect(() => {
    if (reconciliationKey === null || reconciliationKind === null || reconciledStep === null) {
      appliedRouteReconciliationRef.current = null
      return
    }
    if (
      !shouldApplyRouteReconciliation(
        appliedRouteReconciliationRef.current,
        reconciliationKey,
      )
    ) {
      return
    }

    appliedRouteReconciliationRef.current = reconciliationKey
    if (reconciliationKind === 'backbone') setStaleBackboneCleared(true)
    setSearchParams(
      serializeProjectCreateSearch({
        step: reconciledStep,
        processKey: reconciledProcessKey,
        backboneId: reconciledBackboneId,
      }),
      { replace: true },
    )
  }, [
    reconciliationKey,
    reconciliationKind,
    reconciledBackboneId,
    reconciledProcessKey,
    reconciledStep,
    setSearchParams,
  ])

  const downstream404Error =
    previewQuery.isError && getApiErrorStatus(previewQuery.error) === 404
      ? previewQuery.error
      : createMutation.isError && getApiErrorStatus(createMutation.error) === 404
        ? createMutation.error
        : null
  const refetchSelectedProcess = selectedProcessQuery.refetch
  const refetchBackbone = backboneDetailQuery.refetch

  useEffect(() => {
    if (downstream404Error === null) {
      reconciledDownstream404Ref.current = null
      return
    }
    if (reconciledDownstream404Ref.current === downstream404Error) return

    reconciledDownstream404Ref.current = downstream404Error
    void refetchSelectedProcess()
    if (routeState.backboneId !== null) void refetchBackbone()
  }, [downstream404Error, refetchBackbone, refetchSelectedProcess, routeState.backboneId])

  const renderedStep = getRenderedStep(routeState, selectedProcessQuery, selectedProcess)
  const stepHeadingRef = useRef<HTMLHeadingElement>(null)
  const previousStepRef = useRef(renderedStep)

  useEffect(() => {
    if (previousStepRef.current === renderedStep) return

    previousStepRef.current = renderedStep
    const frame = window.requestAnimationFrame(() => stepHeadingRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [renderedStep])

  const createDisabledReason = getCreateDisabledReason({
    processKey: routeState.processKey,
    processIsPending: routeState.processKey !== null && selectedProcessQuery.isPending,
    processIsError: selectedProcessQuery.isError,
    processHasProject: selectedProcess?.has_project ?? false,
    backboneId: routeState.backboneId,
    backboneIsPending: routeState.backboneId !== null && backboneDetailQuery.isPending,
    backboneIsError: backboneDetailQuery.isError,
    previewIsPending: previewEnabled && previewQuery.isPending,
    previewIsFetching: previewQuery.isFetching,
    previewIsError: previewQuery.isError,
    previewFingerprint: previewQuery.data?.fingerprint ?? null,
    currentFingerprint,
    requiredFieldsComplete: partId.trim() !== '' && name.trim() !== '',
    isSubmitting: interactionLocked,
  })

  function setRouteState(next: ProjectCreateRouteState, replace = false) {
    setSearchParams(serializeProjectCreateSearch(next), { replace })
  }

  function updateProcessQuery(value: string) {
    if (submitLockRef.current || interactionLocked) return
    setProcessQuery(value)
  }

  function chooseProcess(processKey: string) {
    if (submitLockRef.current || interactionLocked) return
    if (processKey === routeState.processKey) return

    const next = selectProcess(
      {
        processKey: routeState.processKey,
        backboneId: routeState.backboneId,
        overrides,
      },
      processKey,
    )
    setOverrides(next.overrides)
    setStaleBackboneCleared(false)
    createMutation.reset()
    setRouteState({ step: 1, processKey: next.processKey, backboneId: next.backboneId })
  }

  function chooseBackbone(backboneId: number | null) {
    if (submitLockRef.current || interactionLocked || !processReady) return
    if (backboneId === routeState.backboneId) {
      setStaleBackboneCleared(false)
      return
    }

    const next = selectBackbone(
      {
        processKey: routeState.processKey,
        backboneId: routeState.backboneId,
        overrides,
      },
      backboneId,
    )
    setOverrides(next.overrides)
    setStaleBackboneCleared(false)
    createMutation.reset()
    setRouteState({ ...routeState, backboneId: next.backboneId })
  }

  function goToStep(step: 1 | 2 | 3) {
    if (submitLockRef.current || interactionLocked) return
    if (step === routeState.step || !canVisitStep(step, processReady, explicitBackboneReady)) return
    setRouteState({ ...routeState, step })
  }

  function updateOverride(targetLayerKey: string, sourceLayerKey: string) {
    if (submitLockRef.current || interactionLocked) return

    const baselinePreview = queryClient.getQueryData<PreviewResult>([
      'backbone-preview',
      baselineFingerprint,
    ])
    if (baselinePreview?.fingerprint === baselineFingerprint) {
      baselineAutomaticSourcesRef.current = Object.fromEntries(
        baselinePreview.preview.matches.flatMap((match) =>
          match.match_type === 'auto' && match.source_layer_key
            ? [[match.target_layer_key, match.source_layer_key]]
            : [],
        ),
      )
    }

    setIsDirty(true)
    createMutation.reset()
    setOverrides((current) =>
      updateManualOverride(current, targetLayerKey, sourceLayerKey),
    )
  }

  function updatePartId(value: string) {
    if (submitLockRef.current || interactionLocked) return
    setPartId(value)
    setIsDirty(true)
    createMutation.reset()
  }

  function updateName(value: string) {
    if (submitLockRef.current || interactionLocked) return
    setName(value)
    setIsDirty(true)
    createMutation.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      submitLockRef.current ||
      createDisabledReason !== null ||
      selectedProcess === null
    ) {
      return
    }

    const submission: ProjectCreateSubmission = {
      payload: {
        line_id: selectedProcess.line_id,
        process_id: selectedProcess.process_id,
        part_id: partId.trim(),
        name: name.trim(),
        backbone_project_id: routeState.backboneId,
        manual_overrides: toManualOverrides(overrides),
      },
      process: {
        key: selectedProcess.key,
        line_id: selectedProcess.line_id,
        process_id: selectedProcess.process_id,
      },
    }

    submitLockRef.current = true
    setSubmitLocked(true)
    createMutation.mutate(submission)
  }

  return (
    <div className="space-y-5">
      <WizardStepper
        currentStep={renderedStep}
        processReady={processReady}
        backboneReady={explicitBackboneReady}
        interactionLocked={interactionLocked}
        onStepChange={goToStep}
      />

      <section className="rounded-xl border border-border-subtle bg-surface p-4 shadow-sm sm:p-5">
        {renderedStep === 1 ? (
          <ProcessStep
            headingRef={stepHeadingRef}
            controlsDisabled={interactionLocked}
            processQuery={processQuery}
            onProcessQueryChange={updateProcessQuery}
            processes={processes}
            selectedProcessKey={routeState.processKey}
            selectedProcess={selectedProcess}
            selectedProcessReady={processReady}
            selectedProcessIsPending={
              routeState.processKey !== null && selectedProcessQuery.isPending
            }
            selectedProcessError={
              selectedProcessQuery.isError ? selectedProcessQuery.error : null
            }
            processResults={processResults}
            onChooseProcess={chooseProcess}
            onRetrySelectedProcess={() => selectedProcessQuery.refetch()}
            onContinue={() => goToStep(2)}
          />
        ) : null}

        {renderedStep === 2 ? (
          <BackboneStep
            headingRef={stepHeadingRef}
            selectedProcess={selectedProcess}
            selectedBackboneId={routeState.backboneId}
            candidates={candidatesQuery.data ?? []}
            processIsPending={selectedProcessQuery.isPending}
            controlsDisabled={interactionLocked || !processReady}
            navigationLocked={interactionLocked}
            candidatesIsPending={processReady && candidatesQuery.isPending}
            candidatesError={candidatesQuery.isError ? candidatesQuery.error : null}
            staleBackboneCleared={staleBackboneCleared}
            backboneIsPending={
              processReady && routeState.backboneId !== null && backboneDetailQuery.isPending
            }
            backboneError={backboneDetailQuery.isError ? backboneDetailQuery.error : null}
            onChooseBackbone={chooseBackbone}
            onRetryCandidates={() => candidatesQuery.refetch()}
            onRetryBackbone={() => backboneDetailQuery.refetch()}
            onBack={() => goToStep(1)}
            onContinue={() => goToStep(3)}
          />
        ) : null}

        {renderedStep === 3 ? (
          <PreviewStep
            headingRef={stepHeadingRef}
            controlsDisabled={interactionLocked || !processReady}
            selectedProcess={selectedProcess}
            selectedProcessIsPending={
              routeState.processKey !== null && selectedProcessQuery.isPending
            }
            selectedProcessError={
              selectedProcessQuery.isError ? selectedProcessQuery.error : null
            }
            backboneId={routeState.backboneId}
            backboneIsPending={
              processReady && routeState.backboneId !== null && backboneDetailQuery.isPending
            }
            backboneError={backboneDetailQuery.isError ? backboneDetailQuery.error : null}
            backboneLayers={backboneDetailQuery.data?.layers ?? []}
            previewResult={previewQuery.data ?? null}
            previewIsPending={previewEnabled && previewQuery.isPending}
            previewIsFetching={previewQuery.isFetching}
            previewError={previewQuery.isError ? previewQuery.error : null}
            currentFingerprint={currentFingerprint}
            overrides={overrides}
            baselineAutomaticSources={baselineAutomaticSourcesRef.current}
            partId={partId}
            name={name}
            createDisabledReason={createDisabledReason}
            createError={createMutation.isError ? createMutation.error : null}
            selectedProcessId={selectedProcess?.process_id ?? null}
            onOverrideChange={updateOverride}
            onPartIdChange={updatePartId}
            onNameChange={updateName}
            onRetryProcess={() => selectedProcessQuery.refetch()}
            onRetryBackbone={() => backboneDetailQuery.refetch()}
            onRetryPreview={() => previewQuery.refetch()}
            onBack={() => goToStep(2)}
            onSubmit={submit}
          />
        ) : null}
      </section>

      <p className="text-xs text-muted">
        URL에는 현재 단계와 Process, 백본 선택만 저장됩니다. 새로고침하면 프로젝트 정보와 수동
        매칭 입력은 초기화됩니다.
      </p>
    </div>
  )
}

function WizardStepper({
  currentStep,
  processReady,
  backboneReady,
  interactionLocked,
  onStepChange,
}: {
  currentStep: 1 | 2 | 3
  processReady: boolean
  backboneReady: boolean
  interactionLocked: boolean
  onStepChange: (step: 1 | 2 | 3) => void
}) {
  return (
    <nav aria-label="프로젝트 생성 단계" className="rounded-xl border border-border-subtle bg-surface p-2">
      <ol className="grid gap-2 sm:grid-cols-3">
        {STEPS.map((step) => {
          const isCurrent = step.index === currentStep
          const isComplete = step.index < currentStep
          const enabled = canVisitStep(step.index, processReady, backboneReady)
          const status = isCurrent ? '현재 단계' : isComplete ? '완료' : '미완료'

          return (
            <li key={step.index}>
              <button
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                  isCurrent
                    ? 'border-brand-700 bg-brand-100 text-ink-950'
                    : isComplete
                      ? 'border-border-control bg-surface text-ink-950 hover:bg-canvas'
                      : 'border-transparent bg-canvas text-muted',
                )}
                disabled={interactionLocked || !enabled || isCurrent}
                type="button"
                onClick={() => onStepChange(step.index)}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                    isCurrent || isComplete
                      ? 'border-brand-700 bg-brand-700 text-white'
                      : 'border-border-control bg-surface text-muted',
                  )}
                >
                  {isComplete ? <Check size={15} strokeWidth={2.5} /> : step.index}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{step.title}</span>
                  <span className="block text-xs font-medium">{status}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function ProcessStep({
  headingRef,
  controlsDisabled,
  processQuery,
  onProcessQueryChange,
  processes,
  selectedProcessKey,
  selectedProcess,
  selectedProcessReady,
  selectedProcessIsPending,
  selectedProcessError,
  processResults,
  onChooseProcess,
  onRetrySelectedProcess,
  onContinue,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>
  controlsDisabled: boolean
  processQuery: string
  onProcessQueryChange: (value: string) => void
  processes: ProcessOut[]
  selectedProcessKey: string | null
  selectedProcess: ProcessDetailOut | null
  selectedProcessReady: boolean
  selectedProcessIsPending: boolean
  selectedProcessError: unknown
  processResults: ReturnType<typeof useInfiniteQuery>
  onChooseProcess: (processKey: string) => void
  onRetrySelectedProcess: () => void
  onContinue: () => void
}) {
  const duplicateHref = selectedProcess?.has_project
    ? toProjectListHref({ query: selectedProcess.process_id, status: 'all' })
    : null

  return (
    <div className="space-y-5">
      <StepHeading
        ref={headingRef}
        index={1}
        title="Process 확인"
        description="구조를 검색하고 단계 수, 영역, 기존 프로젝트 여부를 확인하세요."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <div className="space-y-3">
          <label className="grid gap-1.5 text-sm font-semibold text-ink-950" htmlFor="process-picker-query">
            Process 검색
            <span className="relative block">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                size={16}
              />
              <input
                autoComplete="off"
                className="input pl-9"
                disabled={controlsDisabled}
                id="process-picker-query"
                placeholder="Line 또는 Process ID"
                type="search"
                value={processQuery}
                onChange={(event) => onProcessQueryChange(event.target.value)}
              />
            </span>
          </label>

          {processResults.isPending ? (
            <InlineAlert tone="info">Process 목록을 불러오는 중입니다.</InlineAlert>
          ) : null}
          {processResults.isError ? (
            <RetryAlert error={processResults.error} onRetry={() => processResults.refetch()} />
          ) : null}

          {processes.length > 0 ? (
            <ul className="grid gap-2 md:grid-cols-2">
              {processes.map((process) => {
                const selected = process.key === selectedProcessKey
                return (
                  <li key={process.key}>
                    <button
                      aria-pressed={selected}
                      className={cn(
                        'flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                        selected
                          ? 'border-brand-700 bg-brand-100'
                          : 'border-border-subtle bg-surface hover:border-border-control hover:bg-canvas',
                      )}
                      disabled={controlsDisabled}
                      type="button"
                      onClick={() => onChooseProcess(process.key)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink-950" title={process.display_name}>
                          {process.display_name}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted" title={process.key}>
                          {process.key}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        {selected ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-brand-700">
                            <Check aria-hidden="true" size={14} strokeWidth={2.5} />
                            선택됨
                          </span>
                        ) : null}
                        {process.has_project ? <Badge tone="warning">프로젝트 있음</Badge> : null}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : !processResults.isPending && !processResults.isError ? (
            <div className="rounded-lg border border-dashed border-border-control bg-canvas p-5 text-center text-sm text-muted">
              검색 결과가 없습니다.
            </div>
          ) : null}

          {processResults.hasNextPage ? (
            <Button
              loading={processResults.isFetchingNextPage}
              disabled={controlsDisabled}
              variant="secondary"
              onClick={() => processResults.fetchNextPage()}
            >
              더 보기
            </Button>
          ) : null}
        </div>

        <aside className="rounded-lg border border-border-subtle bg-canvas p-4" aria-label="선택한 Process">
          <h3 className="text-sm font-bold text-ink-950">선택한 Process</h3>
          {selectedProcessKey === null ? (
            <p className="mt-2 text-sm text-muted">왼쪽 검색 결과에서 Process를 선택하세요.</p>
          ) : null}
          {selectedProcessIsPending ? (
            <p className="mt-2 text-sm text-muted">선택한 Process를 확인하는 중입니다.</p>
          ) : null}
          {selectedProcessError ? (
            <div className="mt-3">
              <RetryAlert error={selectedProcessError} onRetry={onRetrySelectedProcess} />
            </div>
          ) : null}
          {selectedProcess ? (
            <div className="mt-3 space-y-3">
              <div>
                <p className="font-semibold text-ink-950">{selectedProcess.display_name}</p>
                <p className="mt-0.5 font-mono text-xs text-muted">{selectedProcess.key}</p>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <DetailStat label="Step" value={`${selectedProcess.step_count}개`} />
                <DetailStat
                  label="Area"
                  value={selectedProcess.area_names.join(', ') || '없음'}
                />
              </dl>
              {selectedProcess.has_project ? (
                <InlineAlert tone="warning">
                  <p>이 Process에는 프로젝트가 이미 {selectedProcess.project_count}개 있습니다.</p>
                  <Link className="mt-2 inline-flex font-bold underline underline-offset-2" to={duplicateHref!}>
                    기존 프로젝트 목록에서 선택
                  </Link>
                </InlineAlert>
              ) : selectedProcessReady ? (
                <InlineAlert tone="success">새 프로젝트를 만들 수 있습니다.</InlineAlert>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>

      <div className="flex justify-end border-t border-border-subtle pt-4">
        <Button disabled={controlsDisabled || !selectedProcessReady} onClick={onContinue}>
          백본 선택으로
          <ArrowRight aria-hidden="true" size={16} />
        </Button>
      </div>
    </div>
  )
}

function BackboneStep({
  headingRef,
  controlsDisabled,
  navigationLocked,
  selectedProcess,
  selectedBackboneId,
  candidates,
  processIsPending,
  candidatesIsPending,
  candidatesError,
  staleBackboneCleared,
  backboneIsPending,
  backboneError,
  onChooseBackbone,
  onRetryCandidates,
  onRetryBackbone,
  onBack,
  onContinue,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>
  controlsDisabled: boolean
  navigationLocked: boolean
  selectedProcess: ProcessDetailOut | null
  selectedBackboneId: number | null
  candidates: BackboneCandidateOut[]
  processIsPending: boolean
  candidatesIsPending: boolean
  candidatesError: unknown
  staleBackboneCleared: boolean
  backboneIsPending: boolean
  backboneError: unknown
  onChooseBackbone: (backboneId: number | null) => void
  onRetryCandidates: () => void
  onRetryBackbone: () => void
  onBack: () => void
  onContinue: () => void
}) {
  return (
    <div className="space-y-5">
      <StepHeading
        ref={headingRef}
        index={2}
        title="백본 선택"
        description={`${selectedProcess?.display_name ?? '선택한 Process'}에 복사할 값의 기준을 선택하세요.`}
      />

      {processIsPending ? (
        <InlineAlert tone="info">URL에서 선택한 Process를 복원하는 중입니다.</InlineAlert>
      ) : null}

      {candidatesIsPending ? (
        <InlineAlert tone="info">백본 후보를 불러오는 중입니다.</InlineAlert>
      ) : null}
      {candidatesError ? <RetryAlert error={candidatesError} onRetry={onRetryCandidates} /> : null}
      {backboneIsPending ? (
        <InlineAlert tone="info">선택한 백본 구조를 확인하는 중입니다.</InlineAlert>
      ) : null}
      {backboneError && getApiErrorStatus(backboneError) !== 404 ? (
        <RetryAlert error={backboneError} onRetry={onRetryBackbone} />
      ) : null}
      {staleBackboneCleared ? (
        <InlineAlert tone="warning">
          선택한 백본이 삭제되어 선택을 해제했습니다. 다른 백본을 선택하거나 백본 없이
          시작하세요.
        </InlineAlert>
      ) : null}

      <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
        <BackboneOption
          disabled={controlsDisabled}
          selected={selectedBackboneId === null}
          onSelect={() => onChooseBackbone(null)}
          title="백본 없이 시작"
          subtitle="모든 셀을 빈 값으로 시작합니다."
        />
        {candidates.map((candidate) => (
          <BackboneOption
            key={candidate.id}
            disabled={controlsDisabled}
            selected={selectedBackboneId === candidate.id}
            onSelect={() => onChooseBackbone(candidate.id)}
            title={candidate.name}
            subtitle={`${candidate.part_id} · Layer ${candidate.matched_count}/${candidate.layer_count}`}
            meta={`매칭 ${Math.round(candidate.match_rate * 100)}% · 미매칭 ${candidate.unmatched_count}`}
          />
        ))}
      </div>

      {!candidatesIsPending && !candidatesError && candidates.length === 0 ? (
        <InlineAlert tone="info">
          추천 백본이 없습니다. 백본 없이 시작해도 유효한 프로젝트를 만들 수 있습니다.
        </InlineAlert>
      ) : null}

      <div className="flex flex-wrap justify-between gap-2 border-t border-border-subtle pt-4">
        <Button disabled={navigationLocked} variant="secondary" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={16} />
          Process로
        </Button>
        <Button
          disabled={controlsDisabled || backboneIsPending || Boolean(backboneError)}
          onClick={onContinue}
        >
          매칭 확인으로
          <ArrowRight aria-hidden="true" size={16} />
        </Button>
      </div>
    </div>
  )
}

function PreviewStep({
  headingRef,
  controlsDisabled,
  selectedProcess,
  selectedProcessIsPending,
  selectedProcessError,
  backboneId,
  backboneIsPending,
  backboneError,
  backboneLayers,
  previewResult,
  previewIsPending,
  previewIsFetching,
  previewError,
  currentFingerprint,
  overrides,
  baselineAutomaticSources,
  partId,
  name,
  createDisabledReason,
  createError,
  selectedProcessId,
  onOverrideChange,
  onPartIdChange,
  onNameChange,
  onRetryProcess,
  onRetryBackbone,
  onRetryPreview,
  onBack,
  onSubmit,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>
  controlsDisabled: boolean
  selectedProcess: ProcessDetailOut | null
  selectedProcessIsPending: boolean
  selectedProcessError: unknown
  backboneId: number | null
  backboneIsPending: boolean
  backboneError: unknown
  backboneLayers: Array<{ layer_key: string; step_seq: string; layer_id: string }>
  previewResult: PreviewResult | null
  previewIsPending: boolean
  previewIsFetching: boolean
  previewError: unknown
  currentFingerprint: string
  overrides: Record<string, string>
  baselineAutomaticSources: Record<string, string>
  partId: string
  name: string
  createDisabledReason: CreateDisabledReason | null
  createError: unknown
  selectedProcessId: string | null
  onOverrideChange: (targetLayerKey: string, sourceLayerKey: string) => void
  onPartIdChange: (value: string) => void
  onNameChange: (value: string) => void
  onRetryProcess: () => void
  onRetryBackbone: () => void
  onRetryPreview: () => void
  onBack: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const preview = previewResult?.preview ?? null
  const previewIsCurrent = previewResult?.fingerprint === currentFingerprint
  const existingProjectId = getExistingProjectId(createError)
  const duplicateHref =
    createError && getApiErrorStatus(createError) === 409 && selectedProcessId
      ? existingProjectId !== null
        ? `/projects/${existingProjectId}`
        : toProjectListHref({ query: selectedProcessId, status: 'all' })
      : null

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <StepHeading
        ref={headingRef}
        index={3}
        title="매칭 확인 · 프로젝트 정보"
        description="현재 구조와 정확히 일치하는 미리보기를 확인한 뒤 프로젝트 정보를 입력하세요."
      />

      {selectedProcess ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border-subtle bg-canvas px-3 py-2 text-sm">
          <span className="font-semibold text-ink-950">Process {selectedProcess.display_name}</span>
          <span className="text-muted">
            {backboneId === null ? '백본 없이 시작' : `백본 프로젝트 #${backboneId}`}
          </span>
        </div>
      ) : null}

      {selectedProcessIsPending ? (
        <InlineAlert tone="info">URL에서 선택한 Process를 복원하는 중입니다.</InlineAlert>
      ) : null}
      {selectedProcessError ? <RetryAlert error={selectedProcessError} onRetry={onRetryProcess} /> : null}
      {backboneIsPending ? (
        <InlineAlert tone="info">URL에서 선택한 백본을 복원하는 중입니다.</InlineAlert>
      ) : null}
      {backboneError ? <RetryAlert error={backboneError} onRetry={onRetryBackbone} /> : null}
      {previewIsPending && !preview ? (
        <InlineAlert tone="info">매칭 결과를 계산하는 중입니다.</InlineAlert>
      ) : null}
      {previewError ? <RetryAlert error={previewError} onRetry={onRetryPreview} /> : null}
      {preview && (previewIsFetching || !previewIsCurrent) ? (
        <InlineAlert tone="info">선택 변경을 반영한 새 매칭 결과를 계산하는 중입니다.</InlineAlert>
      ) : null}

      {preview ? (
        <div className="space-y-3">
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <DetailStat label="매칭" value={`${preview.matched_count}개`} />
            <DetailStat label="미매칭" value={`${preview.unmatched_count}개`} />
            <DetailStat label="복사 조건" value={`${preview.copy_condition_count}개`} />
            <DetailStat label="복사 셀" value={`${preview.copy_cell_count}개`} />
          </dl>
          <div className="overflow-x-auto rounded-lg border border-border-subtle">
            <table className="w-full min-w-[720px] table-fixed text-left text-sm">
              <thead className="bg-canvas text-xs font-semibold text-muted">
                <tr className="h-9">
                  <th className="w-[36%] px-3">Target Layer</th>
                  <th className="w-[16%] px-3">매칭 상태</th>
                  <th className="w-[48%] px-3">백본 Source / 수동 매칭</th>
                </tr>
              </thead>
              <tbody>
                {preview.matches.map((match) => (
                  <PreviewMatchRow
                    key={match.target_layer_key}
                    match={match}
                    backboneId={backboneId}
                    backboneLayers={backboneLayers}
                    baselineAutomaticSource={
                      baselineAutomaticSources[match.target_layer_key] ?? null
                    }
                    disabled={controlsDisabled}
                    selectedSource={overrides[match.target_layer_key] ?? ''}
                    onOverrideChange={onOverrideChange}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 border-t border-border-subtle pt-5 md:grid-cols-2">
        <Field inputId="project-part-id" label="Part ID">
          <input
            className="input"
            disabled={controlsDisabled}
            required
            value={partId}
            onChange={(event) => onPartIdChange(event.target.value)}
          />
        </Field>
        <Field inputId="project-name" label="프로젝트명">
          <input
            className="input"
            disabled={controlsDisabled}
            required
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </Field>
      </div>

      {createError ? (
        <InlineAlert tone={duplicateHref ? 'warning' : 'error'}>
          <p>{getApiErrorMessage(createError)}</p>
          {duplicateHref ? (
            <Link className="mt-2 inline-flex font-bold underline underline-offset-2" to={duplicateHref}>
              {existingProjectId !== null ? '기존 프로젝트 열기' : '기존 프로젝트 목록에서 선택'}
            </Link>
          ) : (
            <p className="mt-1 text-xs">입력 내용은 유지되었습니다. 확인 후 다시 시도해 주세요.</p>
          )}
        </InlineAlert>
      ) : null}

      {createDisabledReason ? (
        <p className="text-sm font-medium text-muted" id="project-create-disabled-reason">
          {CREATE_DISABLED_MESSAGE[createDisabledReason]}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-between gap-2 border-t border-border-subtle pt-4">
        <Button disabled={controlsDisabled} type="button" variant="secondary" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={16} />
          백본으로
        </Button>
        <Button
          aria-describedby={
            createDisabledReason ? 'project-create-disabled-reason' : undefined
          }
          disabled={createDisabledReason !== null}
          loading={createDisabledReason === 'submitting'}
          type="submit"
        >
          프로젝트 생성
        </Button>
      </div>
    </form>
  )
}

const StepHeading = forwardRef<
  HTMLHeadingElement,
  { index: number; title: string; description: string }
>(function StepHeading({ index, title, description }, ref) {
  return (
    <div>
      <p className="text-xs font-bold text-brand-700">{index}단계</p>
      <h2
        ref={ref}
        className="mt-1 rounded-sm text-xl font-bold text-ink-950 focus:outline-2 focus:outline-offset-2 focus:outline-brand-700"
        tabIndex={-1}
      >
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </div>
  )
})

function DetailStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-subtle bg-surface px-3 py-2">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-bold text-ink-950" title={typeof value === 'string' ? value : undefined}>
        {value}
      </dd>
    </div>
  )
}

function BackboneOption({
  disabled,
  selected,
  onSelect,
  title,
  subtitle,
  meta,
}: {
  disabled: boolean
  selected: boolean
  onSelect: () => void
  title: string
  subtitle: string
  meta?: string
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        'flex min-h-[76px] w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
        selected
          ? 'border-brand-700 bg-brand-100'
          : 'border-border-subtle bg-surface hover:border-border-control hover:bg-canvas',
      )}
      disabled={disabled}
      type="button"
      onClick={onSelect}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink-950" title={title}>
          {title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted" title={subtitle}>
          {subtitle}
        </span>
        {meta ? <span className="mt-1 block text-xs font-semibold text-brand-700">{meta}</span> : null}
      </span>
      <span className="shrink-0 text-xs font-bold text-ink-950">{selected ? '선택됨' : '선택'}</span>
    </button>
  )
}

function PreviewMatchRow({
  match,
  backboneId,
  backboneLayers,
  baselineAutomaticSource,
  disabled,
  selectedSource,
  onOverrideChange,
}: {
  match: MatchOut
  backboneId: number | null
  backboneLayers: Array<{ layer_key: string; step_seq: string; layer_id: string }>
  baselineAutomaticSource: string | null
  disabled: boolean
  selectedSource: string
  onOverrideChange: (targetLayerKey: string, sourceLayerKey: string) => void
}) {
  return (
    <tr className="h-9 shadow-[inset_0_1px_0_var(--color-border-subtle)]">
      <td className="truncate px-3 font-mono text-xs text-ink-950" title={match.target_layer_key}>
        {match.target_layer_key}
      </td>
      <td className="px-3">
        <MatchBadge type={match.match_type} />
      </td>
      <td className="px-3">
        {backboneId !== null ? (
          <select
            aria-label={`${match.target_layer_key} 수동 매칭`}
            className="input h-[30px] py-0 text-xs"
            disabled={disabled}
            value={selectedSource}
            onChange={(event) => onOverrideChange(match.target_layer_key, event.target.value)}
          >
            <option value="">
              {getManualOverrideDefaultLabel({
                matchType: match.match_type,
                sourceLayerKey: match.source_layer_key,
                baselineAutomaticSource,
              })}
            </option>
            {backboneLayers.map((layer) => (
              <option key={layer.layer_key} value={layer.layer_key}>
                {layer.step_seq}/{layer.layer_id}
              </option>
            ))}
          </select>
        ) : (
          <span className="block truncate font-mono text-xs text-muted" title={match.source_layer_key ?? '-'}>
            {match.source_layer_key ?? '-'}
          </span>
        )}
      </td>
    </tr>
  )
}

function MatchBadge({ type }: { type: MatchType }) {
  const label = type === 'auto' ? '자동' : type === 'manual' ? '수동' : '미매칭'
  const tone = type === 'auto' ? 'draft' : type === 'manual' ? 'warning' : 'neutral'
  return <Badge tone={tone}>{label}</Badge>
}

function RetryAlert({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <InlineAlert className="flex flex-wrap items-center justify-between gap-3" tone="error">
      <span>{getApiErrorMessage(error)}</span>
      <Button size="compact" type="button" variant="secondary" onClick={onRetry}>
        다시 시도
      </Button>
    </InlineAlert>
  )
}

function canVisitStep(
  step: 1 | 2 | 3,
  processReady: boolean,
  backboneReady: boolean,
): boolean {
  if (step === 1) return true
  if (!processReady) return false
  return step === 2 || backboneReady
}

function getRenderedStep(
  routeState: ProjectCreateRouteState,
  selectedProcessQuery: { isPending: boolean; isError: boolean },
  selectedProcess: ProcessDetailOut | null,
): 1 | 2 | 3 {
  if (routeState.processKey === null) return 1
  if (!selectedProcessQuery.isPending && selectedProcessQuery.isError) return 1
  if (selectedProcess?.has_project) return 1
  return routeState.step
}
