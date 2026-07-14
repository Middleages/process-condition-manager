import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent, RefObject } from 'react'
import { useReducer, useState } from 'react'

import {
  getApiErrorMessage,
  getChoiceSetChangedSummary,
} from '@/api/client'
import {
  createChoiceOption,
  fetchAllChoiceOptions,
  getChoiceSet,
  patchChoiceOption,
} from '@/api/choiceSets'
import type {
  ChoiceOptionAggregate,
  ChoiceOptionCreateIn,
  ChoiceOptionOut,
  ChoiceOptionPatchIn,
  ChoiceOptionMutationOut,
  ChoiceSetSummaryOut,
} from '@/api/types'
import { Button } from '@/shared/components/Button'
import { Field } from '@/shared/components/Field'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { Dialog } from '@/shared/components/ModalSurface'
import { useUnsavedChanges } from '@/shared/navigation/useUnsavedChanges'

import {
  CHOICE_CODE_HELP,
  completeChoiceSetMutation,
  findCaseOnlyCodeCollision,
  isExactChoiceSetAdminSnapshot,
  isUrlSafeChoiceCode,
  loadExactChoiceSetAdminSnapshot,
  resetChoiceMutationErrors,
  type ChoiceSetAdminSnapshot,
} from './choiceSetAdminState'
import {
  choiceSetKeys,
  invalidateChoiceSetMutation,
} from './choiceQueries'

export type ChoiceOptionEditorTarget =
  | { kind: 'create' }
  | { kind: 'edit'; option: ChoiceOptionOut }
  | { kind: 'deactivate'; option: ChoiceOptionOut }

export interface ChoiceOptionEditorDraft {
  code: string
  label: string
  sortOrder: string
  isActive: boolean
}

export interface ChoiceOptionEditorSession {
  open: true
  mode: ChoiceOptionEditorTarget['kind']
  original: ChoiceOptionOut | null
  baseVersion: number
  draft: ChoiceOptionEditorDraft
  conflict: ChoiceSetSummaryOut | null
  validationMessage: string | null
  rebased: boolean
  touched: ReadonlySet<keyof ChoiceOptionEditorDraft>
  impactAcknowledged: boolean
}

type ChoiceOptionEditorAction =
  | {
      type: 'change-field'
      field: keyof ChoiceOptionEditorDraft
      value: ChoiceOptionEditorDraft[keyof ChoiceOptionEditorDraft]
    }
  | { type: 'validation'; message: string | null }
  | { type: 'conflict'; latest: ChoiceSetSummaryOut }
  | {
      type: 'reload-latest'
      latestSummary: ChoiceSetSummaryOut
      latestOption: ChoiceOptionOut | null
    }
  | { type: 'acknowledge-impact'; acknowledged: boolean }

export type ChoiceOptionSubmission =
  | { kind: 'create'; setCode: string; payload: ChoiceOptionCreateIn }
  | {
      kind: 'patch'
      setCode: string
      optionCode: string
      payload: ChoiceOptionPatchIn
    }

export function startChoiceOptionEditorSession(
  target: ChoiceOptionEditorTarget,
  summary: ChoiceSetSummaryOut,
): ChoiceOptionEditorSession {
  const original = target.kind === 'create' ? null : target.option
  return {
    open: true,
    mode: target.kind,
    original,
    baseVersion: summary.version,
    draft:
      original === null
        ? { code: '', label: '', sortOrder: '', isActive: true }
        : {
            code: original.code,
            label: original.label,
            sortOrder: String(original.sort_order),
            isActive: original.is_active,
          },
    conflict: null,
    validationMessage: null,
    rebased: false,
    touched: new Set(),
    impactAcknowledged: false,
  }
}

export function choiceOptionEditorReducer(
  state: ChoiceOptionEditorSession,
  action: ChoiceOptionEditorAction,
): ChoiceOptionEditorSession {
  switch (action.type) {
    case 'change-field':
      return {
        ...state,
        draft: { ...state.draft, [action.field]: action.value },
        touched: new Set([...state.touched, action.field]),
      }
    case 'validation':
      return { ...state, validationMessage: action.message }
    case 'conflict':
      return { ...state, conflict: action.latest }
    case 'acknowledge-impact':
      return { ...state, impactAcknowledged: action.acknowledged }
    case 'reload-latest': {
      const latestOption = action.latestOption
      const isExisting = state.mode !== 'create'
      const nextDraft =
        isExisting && latestOption
          ? {
              code: latestOption.code,
              label: latestOption.label,
              sortOrder: String(latestOption.sort_order),
              isActive: latestOption.is_active,
            }
          : { code: '', label: '', sortOrder: '', isActive: true }
      return {
        ...state,
        original: isExisting ? latestOption : null,
        baseVersion: action.latestSummary.version,
        draft: nextDraft,
        conflict: null,
        validationMessage: null,
        rebased: true,
        touched: new Set(),
        impactAcknowledged: false,
      }
    }
  }
}

export function buildChoiceOptionSubmission(
  setCode: string,
  session: ChoiceOptionEditorSession,
  snapshot: ChoiceSetAdminSnapshot,
): ChoiceOptionSubmission | null {
  if (
    snapshot.summary.code !== setCode ||
    session.baseVersion !== snapshot.summary.version ||
    !isExactChoiceSetAdminSnapshot(snapshot.summary, snapshot.aggregate, true) ||
    session.conflict !== null
  ) {
    return null
  }

  const label = session.draft.label.trim()
  const sortOrder = Number(session.draft.sortOrder)
  if (label === '') {
    return null
  }

  if (session.mode === 'create') {
    if (
      session.draft.code.length > 128 ||
      !isUrlSafeChoiceCode(session.draft.code)
    ) {
      return null
    }
    const payload: ChoiceOptionCreateIn = {
      expected_version: session.baseVersion,
      code: session.draft.code,
      label,
      is_active: session.draft.isActive,
    }
    if (session.draft.sortOrder.trim() !== '') {
      if (!Number.isInteger(sortOrder)) return null
      payload.sort_order = sortOrder
    }
    return {
      kind: 'create',
      setCode,
      payload,
    }
  }

  if (!Number.isInteger(sortOrder) || session.draft.sortOrder.trim() === '') {
    return null
  }

  if (
    session.original === null ||
    !snapshot.aggregate.items.some(
      (option) => option.code === session.original?.code,
    )
  ) {
    return null
  }
  if (session.mode === 'deactivate') {
    if (!session.impactAcknowledged) return null
    return {
      kind: 'patch',
      setCode,
      optionCode: session.original.code,
      payload: {
        expected_version: session.baseVersion,
        is_active: false,
      },
    }
  }
  return {
    kind: 'patch',
    setCode,
    optionCode: session.original.code,
    payload: {
      expected_version: session.baseVersion,
      label,
      sort_order: sortOrder,
      is_active: session.draft.isActive,
    },
  }
}

export function submitChoiceOptionEditorSession(
  setCode: string,
  session: ChoiceOptionEditorSession,
  snapshot: ChoiceSetAdminSnapshot,
  mutate: (submission: ChoiceOptionSubmission) => void,
): boolean {
  const submission = buildChoiceOptionSubmission(setCode, session, snapshot)
  if (submission === null) return false
  mutate(submission)
  return true
}

export interface ChoiceOptionEditorDialogProps {
  setCode: string
  summary: ChoiceSetSummaryOut
  aggregate: ChoiceOptionAggregate
  target: ChoiceOptionEditorTarget
  fallbackFocusRef: RefObject<HTMLElement>
  onClose: () => void
}

export function ChoiceOptionEditorDialog({
  setCode,
  summary,
  aggregate,
  target,
  fallbackFocusRef,
  onClose,
}: ChoiceOptionEditorDialogProps) {
  const queryClient = useQueryClient()
  const [session, dispatch] = useReducer(
    choiceOptionEditorReducer,
    undefined,
    () => startChoiceOptionEditorSession(target, summary),
  )
  const [snapshot, setSnapshot] = useState<ChoiceSetAdminSnapshot>({
    summary,
    aggregate,
  })

  const mutation = useMutation<ChoiceOptionMutationOut, unknown, ChoiceOptionSubmission>({
    mutationFn: (submission) =>
      submission.kind === 'create'
        ? createChoiceOption(submission.setCode, submission.payload)
        : patchChoiceOption(
            submission.setCode,
            submission.optionCode,
            submission.payload,
          ),
    onSuccess: async (result) => {
      await completeChoiceSetMutation(
        () => invalidateChoiceSetMutation(queryClient, result.choice_set.code),
        onClose,
      )
    },
    onError: (error) => {
      const latest = getChoiceSetChangedSummary(error)
      if (latest) dispatch({ type: 'conflict', latest })
    },
  })

  const reloadMutation = useMutation({
    mutationFn: () =>
      loadExactChoiceSetAdminSnapshot(setCode, {
        loadSummary: getChoiceSet,
        loadAggregate: (code, version) =>
          fetchAllChoiceOptions(code, version, true),
      }),
    onSuccess: (nextSnapshot) => {
      const latestOption =
        target.kind === 'create'
          ? null
          : nextSnapshot.aggregate.items.find(
              (option) => option.code === target.option.code,
            ) ?? null
      queryClient.setQueryData(
        choiceSetKeys.summary(setCode),
        nextSnapshot.summary,
      )
      queryClient.setQueryData(
        choiceSetKeys.options(setCode, nextSnapshot.summary.version, true),
        nextSnapshot.aggregate,
      )
      setSnapshot(nextSnapshot)
      dispatch({
        type: 'reload-latest',
        latestSummary: nextSnapshot.summary,
        latestOption,
      })
    },
  })
  const pending = mutation.isPending || reloadMutation.isPending

  useUnsavedChanges({
    when: isChoiceOptionEditorDirty(session),
    freezeWhen: pending,
    message: '저장하지 않은 선택지 변경이 있습니다. 변경을 버리고 이동할까요?',
  })

  function submit() {
    if (
      !submitChoiceOptionEditorSession(
        setCode,
        session,
        snapshot,
        mutation.mutate,
      ) &&
      session.conflict === null &&
      session.mode !== 'deactivate'
    ) {
      dispatch({ type: 'validation', message: '입력값을 확인해 주세요.' })
    }
  }

  return (
    <ChoiceOptionEditorDialogView
      aggregate={snapshot.aggregate}
      summary={snapshot.summary}
      session={session}
      pending={pending}
      mutationError={session.conflict === null ? mutation.error : null}
      reloadError={reloadMutation.error}
      fallbackFocusRef={fallbackFocusRef}
      onAcknowledge={(acknowledged) =>
        dispatch({ type: 'acknowledge-impact', acknowledged })
      }
      onChange={(field, value) => dispatch({ type: 'change-field', field, value })}
      onClose={onClose}
      onReload={() => {
        resetChoiceMutationErrors(mutation.reset, reloadMutation.reset)
        reloadMutation.mutate()
      }}
      onSubmit={submit}
    />
  )
}

export interface ChoiceOptionEditorDialogViewProps {
  summary: ChoiceSetSummaryOut
  aggregate: ChoiceOptionAggregate
  session: ChoiceOptionEditorSession
  pending: boolean
  mutationError?: unknown
  reloadError?: unknown
  fallbackFocusRef: RefObject<HTMLElement>
  onAcknowledge: (acknowledged: boolean) => void
  onChange: (
    field: keyof ChoiceOptionEditorDraft,
    value: ChoiceOptionEditorDraft[keyof ChoiceOptionEditorDraft],
  ) => void
  onClose: () => void
  onReload: () => void
  onSubmit: () => void
}

export function ChoiceOptionEditorDialogView({
  summary,
  aggregate,
  session,
  pending,
  mutationError,
  reloadError,
  fallbackFocusRef,
  onAcknowledge,
  onChange,
  onClose,
  onReload,
  onSubmit,
}: ChoiceOptionEditorDialogViewProps) {
  const snapshot = { summary, aggregate }
  const submission = buildChoiceOptionSubmission(summary.code, session, snapshot)
  const codeInvalid =
    session.mode === 'create' &&
    session.draft.code !== '' &&
    (session.draft.code.length > 128 ||
      !isUrlSafeChoiceCode(session.draft.code))
  const collision =
    session.mode === 'create'
      ? findCaseOnlyCodeCollision(aggregate.items, session.draft.code)
      : null
  const title =
    session.mode === 'create'
      ? '선택지 추가'
      : session.mode === 'edit'
        ? '선택지 수정'
        : '선택지 사용 중지'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Dialog
      open={session.open}
      title={title}
      fallbackFocusRef={fallbackFocusRef}
      onRequestClose={() => {
        if (!pending) onClose()
      }}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            취소
          </Button>
          {session.conflict ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={onReload}
            >
              최신 버전 불러오기
            </Button>
          ) : null}
          <Button
            form="choice-option-editor-form"
            type="submit"
            variant={session.mode === 'deactivate' ? 'danger' : 'primary'}
            loading={pending}
            disabled={pending || submission === null}
          >
            {session.mode === 'deactivate'
              ? '사용 중지'
              : session.conflict || session.rebased
                ? '다시 저장'
                : '저장'}
          </Button>
        </>
      }
    >
      <form id="choice-option-editor-form" className="space-y-4" onSubmit={submit}>
        {session.conflict ? (
          <InlineAlert tone="warning">
            다른 관리자가 버전 {session.conflict.version}로 변경했습니다. 현재 초안은 그대로
            유지됩니다. 최신 버전을 불러온 뒤 다시 저장하세요.
          </InlineAlert>
        ) : null}
        {mutationError ? (
          <InlineAlert tone="error">
            저장하지 못했습니다. 초안은 유지됩니다. {getApiErrorMessage(mutationError)}
          </InlineAlert>
        ) : null}
        {reloadError ? (
          <InlineAlert tone="error">
            최신 버전을 불러오지 못했습니다. {getApiErrorMessage(reloadError)}
          </InlineAlert>
        ) : null}
        {session.validationMessage ? (
          <InlineAlert tone="error">{session.validationMessage}</InlineAlert>
        ) : null}

        {session.mode === 'deactivate' ? (
          <DeactivateImpact
            summary={session.conflict ?? summary}
            option={session.original}
            acknowledged={session.impactAcknowledged}
            disabled={pending}
            onAcknowledge={onAcknowledge}
          />
        ) : (
          <>
            <Field
              inputId="choice-option-code"
              label="Code"
              help={
                session.mode === 'create'
                  ? CHOICE_CODE_HELP
                  : 'Code는 생성 후 바꿀 수 없습니다.'
              }
              error={codeInvalid ? CHOICE_CODE_HELP : undefined}
            >
              <input
                className="input font-mono"
                maxLength={128}
                readOnly={session.mode !== 'create'}
                disabled={pending}
                value={session.draft.code}
                onChange={(event) => onChange('code', event.target.value)}
              />
            </Field>
            {collision ? (
              <InlineAlert tone="warning">
                대소문자만 다른 코드가 이미 있습니다: {collision}. 코드는 대소문자를 정확히
                구분합니다. 이 경고는 저장을 막지 않습니다.
              </InlineAlert>
            ) : null}
            <Field inputId="choice-option-label" label="표시명">
              <input
                className="input"
                disabled={pending}
                value={session.draft.label}
                onChange={(event) => onChange('label', event.target.value)}
              />
            </Field>
            <Field
              inputId="choice-option-sort-order"
              label="정렬 순서"
              help="전체 순서 변경은 상세 화면의 위/아래 버튼을 사용하세요."
            >
              <input
                className="input"
                disabled={pending}
                inputMode="numeric"
                value={session.draft.sortOrder}
                onChange={(event) => onChange('sortOrder', event.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink-950">
              <input
                checked={session.draft.isActive}
                disabled={pending || !summary.is_active}
                type="checkbox"
                onChange={(event) => onChange('isActive', event.target.checked)}
              />
              선택지 활성화
            </label>
          </>
        )}
      </form>
    </Dialog>
  )
}

function DeactivateImpact({
  summary,
  option,
  acknowledged,
  disabled,
  onAcknowledge,
}: {
  summary: ChoiceSetSummaryOut
  option: ChoiceOptionOut | null
  acknowledged: boolean
  disabled: boolean
  onAcknowledge: (acknowledged: boolean) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-950">
        <strong className="font-mono">{option?.code}</strong>를 새 값으로 선택할 수 없게 됩니다.
        기존 저장값은 계속 읽을 수 있습니다.
      </p>
      <div className="rounded-lg border border-warning bg-warning-surface p-3 text-sm text-warning">
        <p className="font-semibold">영향 범위</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>파라미터 {summary.parameter_usage_count}곳</li>
          <li>
            고정 Profile 필드 {summary.profile_usage_fields.length}곳:{' '}
            {summary.profile_usage_fields.join(', ') || '없음'}
          </li>
        </ul>
      </div>
      <label className="flex items-start gap-2 text-sm font-semibold text-ink-950">
        <input
          className="mt-0.5"
          checked={acknowledged}
          disabled={disabled}
          type="checkbox"
          onChange={(event) => onAcknowledge(event.target.checked)}
        />
        영향 범위를 확인했습니다.
      </label>
    </div>
  )
}

function isChoiceOptionEditorDirty(session: ChoiceOptionEditorSession): boolean {
  if (session.mode === 'deactivate') return session.impactAcknowledged
  if (session.mode === 'create') {
    return (
      session.draft.code !== '' ||
      session.draft.label !== '' ||
      session.draft.sortOrder !== ''
    )
  }
  const original = session.original
  return (
    original !== null &&
    (session.draft.label !== original.label ||
      session.draft.sortOrder !== String(original.sort_order) ||
      session.draft.isActive !== original.is_active)
  )
}
