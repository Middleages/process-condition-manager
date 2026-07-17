import {
  useMemo,
  useReducer,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

import type { ValidationSummaryOut } from '@/api/types'
import { cn } from '@/shared/lib/cn'

import {
  VALIDATION_DEFINITIONS_FAILURE,
  VALIDATION_SERVER_FAILURE,
  type EffectiveValidationState,
} from './validationState'
import type { ServerConfirmation } from './useSheetValidation'
import {
  VALIDATION_WORKBENCH_MAX_HEIGHT,
  VALIDATION_WORKBENCH_MIN_HEIGHT,
  createValidationWorkbenchState,
  filterValidationWorkbenchIssues,
  handleValidationTileActivationKey,
  reduceValidationWorkbenchState,
  type ValidationWorkbenchIssue,
} from './validationWorkbenchState'

export interface ValidationWorkbenchProps {
  issues: readonly ValidationWorkbenchIssue[]
  summary: ValidationSummaryOut | null
  issueAuthority: EffectiveValidationState['authority']
  serverConfirmation: ServerConfirmation
  serverFailure: string | null
  definitionsPending?: boolean
  navigationStatus?: string | null
  onIssueActivate: (issue: ValidationWorkbenchIssue) => void
  onRetry: () => void
  defaultHeight?: number
}

export function ValidationWorkbench({
  issues,
  summary,
  issueAuthority,
  serverConfirmation,
  serverFailure,
  definitionsPending = false,
  navigationStatus = null,
  onIssueActivate,
  onRetry,
  defaultHeight,
}: ValidationWorkbenchProps) {
  const [state, dispatch] = useReducer(
    reduceValidationWorkbenchState,
    { panelHeight: defaultHeight },
    (initial) =>
      createValidationWorkbenchState({
        ...(initial.panelHeight === undefined ? {} : { panelHeight: initial.panelHeight }),
      }),
  )
  const dragRef = useRef<{
    pointerId: number
    startY: number
    startHeight: number
  } | null>(null)
  const filteredIssues = useMemo(
    () => filterValidationWorkbenchIssues(issues, state),
    [issues, state],
  )
  const actualErrorCount = issues.filter((issue) => issue.severity === 'error').length
  const actualWarningCount = issues.length - actualErrorCount
  const errorCount = summary?.error_count ?? actualErrorCount
  const warningCount = summary?.warning_count ?? actualWarningCount
  const stripStatus = validationStripStatus({
    issueAuthority,
    serverConfirmation,
    serverFailure,
    definitionsPending,
    errorCount,
    warningCount,
  })
  const canRetry =
    !definitionsPending &&
    serverConfirmation === 'failed' &&
    serverFailure === VALIDATION_SERVER_FAILURE

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    dispatch({ type: 'resize-by', delta: event.key === 'ArrowUp' ? 1 : -1 })
  }

  function beginResize(event: PointerEvent<HTMLDivElement>): void {
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: state.panelHeight,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function continueResize(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    dispatch({
      type: 'set-height',
      height: drag.startHeight + drag.startY - event.clientY,
    })
  }

  function finishResize(event: PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <section
      aria-label="검증 결과"
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-border-subtle bg-surface',
      )}
      data-validation-workbench
      style={{ height: state.panelHeight }}
    >
      <div
        aria-label="검증 패널 높이 조절"
        aria-orientation="horizontal"
        aria-valuemax={VALIDATION_WORKBENCH_MAX_HEIGHT}
        aria-valuemin={VALIDATION_WORKBENCH_MIN_HEIGHT}
        aria-valuenow={state.panelHeight}
        className="h-2 shrink-0 cursor-row-resize bg-border-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-700"
        onKeyDown={resizeWithKeyboard}
        onPointerCancel={finishResize}
        onPointerDown={beginResize}
        onPointerMove={continueResize}
        onPointerUp={finishResize}
        role="separator"
        tabIndex={0}
      />

      <div
        className={cn(
          'flex h-[30px] min-w-0 shrink-0 items-center gap-2 px-3 text-xs',
          stripStatus.toneClass,
        )}
        data-testid="validation-summary-strip"
        >
        <strong className="shrink-0 text-error">오류 {errorCount}</strong>
        <strong className="shrink-0 text-warning">경고 {warningCount}</strong>
        <span aria-live="polite" className="min-w-0 flex-1 truncate" role="status">
          {stripStatus.message}
        </span>
        {canRetry ? (
          <button
            className="shrink-0 rounded-sm font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
            onClick={onRetry}
            type="button"
          >
            다시 시도
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-border-subtle bg-canvas p-2">
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
          <button
            aria-pressed={state.showErrors}
            className={filterClass(state.showErrors, 'error')}
            onClick={() => dispatch({ type: 'toggle-severity', severity: 'error' })}
            type="button"
          >
            오류 {actualErrorCount}
          </button>
          <button
            aria-pressed={state.showWarnings}
            className={filterClass(state.showWarnings, 'warning')}
            onClick={() => dispatch({ type: 'toggle-severity', severity: 'warning' })}
            type="button"
          >
            경고 {actualWarningCount}
          </button>
          <span aria-live="polite" className="ml-auto text-xs text-muted" role="status">
            표시 {filteredIssues.length} / 전체 {issues.length}
          </span>
        </div>

        {navigationStatus !== null ? (
          <p aria-live="polite" className="mb-2 shrink-0 text-xs text-muted" role="status">
            {navigationStatus}
          </p>
        ) : null}

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          {filteredIssues.length > 0 ? (
            <div className="grid min-w-0 grid-cols-1 gap-2 min-[640px]:grid-cols-2 min-[1024px]:grid-cols-3 min-[1440px]:grid-cols-4 min-[1920px]:grid-cols-5">
              {filteredIssues.map((issue) => (
                <ValidationIssueTile
                  key={issue.key}
                  issue={issue}
                  selected={state.selectedIssueKey === issue.key}
                  onActivate={() => {
                    dispatch({ type: 'select-issue', key: issue.key })
                    onIssueActivate(issue)
                  }}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-border-subtle bg-surface p-3 text-sm text-muted">
              {issues.length === 0
                ? stripStatus.message
                : '선택한 필터에 표시할 검증 항목이 없습니다.'}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function ValidationIssueTile({
  issue,
  selected,
  onActivate,
}: {
  issue: ValidationWorkbenchIssue
  selected: boolean
  onActivate: () => void
}) {
  function activateWithKeyboard(event: KeyboardEvent<HTMLButtonElement>): void {
    handleValidationTileActivationKey(
      event.key,
      event.repeat,
      () => event.preventDefault(),
      onActivate,
    )
  }

  return (
    <button
      aria-expanded={selected}
      aria-label={issue.accessibleDescription}
      className={cn(
        'min-h-[50px] w-full min-w-0 overflow-hidden rounded-md border bg-surface px-2 py-1 text-left text-xs text-ink-950 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700',
        issue.severity === 'error' ? 'border-error' : 'border-warning',
        selected ? 'h-auto' : 'h-[50px]',
      )}
      onClick={onActivate}
      onKeyDown={activateWithKeyboard}
      title={issue.guidance}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-1.5 leading-4">
        <strong className={issue.severity === 'error' ? 'text-error' : 'text-warning'}>
          {issue.severityLabel}
        </strong>
        <span className="min-w-0 truncate font-semibold">
          {issue.layerLabel} · {issue.conditionLabel} · {issue.parameterName}
        </span>
      </span>
      <span className="flex min-w-0 gap-1.5 leading-4 text-muted">
        {issue.currentValue !== null && issue.currentValue !== '' ? (
          <span className="max-w-[35%] shrink-0 truncate font-mono" title={issue.currentValue}>
            현재 {issue.currentValue}
          </span>
        ) : null}
        <span className={cn('min-w-0', selected ? 'whitespace-normal' : 'truncate')}>
          {issue.guidance}
        </span>
      </span>
    </button>
  )
}

function validationStripStatus({
  issueAuthority,
  serverConfirmation,
  serverFailure,
  definitionsPending,
  errorCount,
  warningCount,
}: Pick<
  ValidationWorkbenchProps,
  'issueAuthority' | 'serverConfirmation' | 'serverFailure' | 'definitionsPending'
> & {
  errorCount: number
  warningCount: number
}): { message: string; toneClass: string } {
  if (definitionsPending) {
    return {
      message: '검증 규칙을 불러오는 중',
      toneClass: 'bg-canvas text-ink-950',
    }
  }
  if (issueAuthority === 'unavailable') {
    return {
      message: serverFailure ?? VALIDATION_DEFINITIONS_FAILURE,
      toneClass: 'bg-error-surface text-error',
    }
  }
  if (serverConfirmation === 'failed' && serverFailure !== null) {
    return { message: serverFailure, toneClass: 'bg-warning-surface text-warning' }
  }
  if (serverConfirmation === 'waiting-for-persistence') {
    return { message: '저장 완료를 기다리는 중', toneClass: 'bg-canvas text-ink-950' }
  }
  if (serverConfirmation === 'validating') {
    return { message: '서버 확인 중', toneClass: 'bg-canvas text-ink-950' }
  }
  if (
    issueAuthority === 'authoritative' &&
    serverConfirmation === 'confirmed' &&
    errorCount === 0 &&
    warningCount === 0
  ) {
    return { message: '검증 완료 · 문제 없음', toneClass: 'bg-success-surface text-success' }
  }
  if (errorCount > 0) {
    return {
      message: issueAuthority === 'authoritative' ? '서버 확인됨' : '로컬 임시 결과 · 서버 확인 대기',
      toneClass: 'bg-error-surface text-error',
    }
  }
  if (warningCount > 0) {
    return {
      message: issueAuthority === 'authoritative' ? '서버 확인됨' : '로컬 임시 결과 · 서버 확인 대기',
      toneClass: 'bg-warning-surface text-warning',
    }
  }
  return {
    message: issueAuthority === 'authoritative' ? '서버 확인됨' : '로컬 임시 결과 · 서버 확인 대기',
    toneClass: 'bg-canvas text-ink-950',
  }
}

function filterClass(selected: boolean, severity: 'error' | 'warning'): string {
  return cn(
    'h-[30px] rounded-md border px-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700',
    selected
      ? severity === 'error'
        ? 'border-error bg-error-surface text-error'
        : 'border-warning bg-warning-surface text-warning'
      : 'border-border-control bg-surface text-muted',
  )
}
