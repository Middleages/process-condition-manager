import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent, RefObject } from 'react'
import { useReducer } from 'react'

import {
  getApiErrorMessage,
  getChoiceSetChangedSummary,
} from '@/api/client'
import { createChoiceSet, patchChoiceSet } from '@/api/choiceSets'
import type {
  ChoiceSetCreateIn,
  ChoiceSetPatchIn,
  ChoiceSetSummaryOut,
} from '@/api/types'
import { Button } from '@/shared/components/Button'
import { Field } from '@/shared/components/Field'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { Drawer } from '@/shared/components/ModalSurface'
import { useUnsavedChanges } from '@/shared/navigation/useUnsavedChanges'

import {
  CHOICE_CODE_HELP,
  completeChoiceSetMutation,
  isUrlSafeChoiceCode,
  resetChoiceMutationErrors,
} from './choiceSetAdminState'
import { invalidateChoiceSetMutation } from './choiceQueries'

export type ChoiceSetEditorTarget =
  | { kind: 'create' }
  | { kind: 'edit'; summary: ChoiceSetSummaryOut }

export interface ChoiceSetEditorDraft {
  code: string
  displayName: string
  description: string
  isActive: boolean
}

export interface ChoiceSetEditorSession {
  open: true
  mode: ChoiceSetEditorTarget['kind']
  original: ChoiceSetSummaryOut | null
  baseVersion: number | null
  draft: ChoiceSetEditorDraft
  conflict: ChoiceSetSummaryOut | null
  validationMessage: string | null
  rebased: boolean
  touched: ReadonlySet<keyof ChoiceSetEditorDraft>
}

type ChoiceSetEditorAction =
  | {
      type: 'change-field'
      field: keyof ChoiceSetEditorDraft
      value: ChoiceSetEditorDraft[keyof ChoiceSetEditorDraft]
    }
  | { type: 'validation'; message: string | null }
  | { type: 'conflict'; latest: ChoiceSetSummaryOut }
  | { type: 'reload-latest' }

export type ChoiceSetEditorSubmission =
  | { kind: 'create'; payload: ChoiceSetCreateIn }
  | { kind: 'patch'; setCode: string; payload: ChoiceSetPatchIn }

export function startChoiceSetEditorSession(
  target: ChoiceSetEditorTarget,
): ChoiceSetEditorSession {
  if (target.kind === 'create') {
    return {
      open: true,
      mode: 'create',
      original: null,
      baseVersion: null,
      draft: { code: '', displayName: '', description: '', isActive: true },
      conflict: null,
      validationMessage: null,
      rebased: false,
      touched: new Set(),
    }
  }

  return {
    open: true,
    mode: 'edit',
    original: target.summary,
    baseVersion: target.summary.version,
    draft: {
      code: target.summary.code,
      displayName: target.summary.display_name,
      description: target.summary.description ?? '',
      isActive: target.summary.is_active,
    },
    conflict: null,
    validationMessage: null,
    rebased: false,
    touched: new Set(),
  }
}

export function choiceSetEditorReducer(
  state: ChoiceSetEditorSession,
  action: ChoiceSetEditorAction,
): ChoiceSetEditorSession {
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
    case 'reload-latest':
      if (state.conflict === null) return state
      return {
        ...state,
        original: state.conflict,
        baseVersion: state.conflict.version,
        draft: {
          code: state.conflict.code,
          displayName: state.conflict.display_name,
          description: state.conflict.description ?? '',
          isActive: state.conflict.is_active,
        },
        conflict: null,
        validationMessage: null,
        rebased: true,
        touched: new Set(),
      }
  }
}

export function buildChoiceSetEditorSubmission(
  session: ChoiceSetEditorSession,
): ChoiceSetEditorSubmission | null {
  const displayName = session.draft.displayName.trim()
  const description = session.draft.description.trim() || null
  if (displayName === '') return null

  if (session.mode === 'create') {
    if (
      session.draft.code.length > 64 ||
      !isUrlSafeChoiceCode(session.draft.code)
    ) {
      return null
    }
    return {
      kind: 'create',
      payload: {
        code: session.draft.code,
        display_name: displayName,
        description,
      },
    }
  }

  if (session.original === null || session.baseVersion === null) return null
  return {
    kind: 'patch',
    setCode: session.original.code,
    payload: {
      expected_version: session.baseVersion,
      display_name: displayName,
      description,
      is_active: session.draft.isActive,
    },
  }
}

export function submitChoiceSetEditorSession(
  session: ChoiceSetEditorSession,
  mutate: (submission: ChoiceSetEditorSubmission) => void,
): boolean {
  const submission = buildChoiceSetEditorSubmission(session)
  if (submission === null || session.conflict !== null) return false
  mutate(submission)
  return true
}

export interface ChoiceSetEditorDrawerProps {
  target: ChoiceSetEditorTarget
  fallbackFocusRef: RefObject<HTMLElement>
  onClose: () => void
}

export function ChoiceSetEditorDrawer({
  target,
  fallbackFocusRef,
  onClose,
}: ChoiceSetEditorDrawerProps) {
  const queryClient = useQueryClient()
  const [session, dispatch] = useReducer(
    choiceSetEditorReducer,
    target,
    startChoiceSetEditorSession,
  )
  const mutation = useMutation<ChoiceSetSummaryOut, unknown, ChoiceSetEditorSubmission>({
    mutationFn: (submission) =>
      submission.kind === 'create'
        ? createChoiceSet(submission.payload)
        : patchChoiceSet(submission.setCode, submission.payload),
    onSuccess: async (choiceSet) => {
      await completeChoiceSetMutation(
        () => invalidateChoiceSetMutation(queryClient, choiceSet.code),
        onClose,
      )
    },
    onError: (error) => {
      const latest = getChoiceSetChangedSummary(error)
      if (latest) dispatch({ type: 'conflict', latest })
    },
  })

  const dirty = isChoiceSetEditorDirty(session)
  useUnsavedChanges({
    when: dirty,
    freezeWhen: mutation.isPending,
    message: '저장하지 않은 선택지 집합 변경이 있습니다. 변경을 버리고 이동할까요?',
  })

  function submit() {
    const submitted = submitChoiceSetEditorSession(session, mutation.mutate)
    if (!submitted && session.conflict === null) {
      dispatch({ type: 'validation', message: '입력값을 확인해 주세요.' })
    }
  }

  return (
    <ChoiceSetEditorDrawerView
      session={session}
      pending={mutation.isPending}
      mutationError={session.conflict === null ? mutation.error : null}
      fallbackFocusRef={fallbackFocusRef}
      onChange={(field, value) => dispatch({ type: 'change-field', field, value })}
      onClose={onClose}
      onReload={() => {
        resetChoiceMutationErrors(mutation.reset)
        dispatch({ type: 'reload-latest' })
      }}
      onSubmit={submit}
    />
  )
}

export interface ChoiceSetEditorDrawerViewProps {
  session: ChoiceSetEditorSession
  pending: boolean
  mutationError?: unknown
  fallbackFocusRef: RefObject<HTMLElement>
  onChange: (
    field: keyof ChoiceSetEditorDraft,
    value: ChoiceSetEditorDraft[keyof ChoiceSetEditorDraft],
  ) => void
  onClose: () => void
  onReload: () => void
  onSubmit: () => void
}

export function ChoiceSetEditorDrawerView({
  session,
  pending,
  mutationError,
  fallbackFocusRef,
  onChange,
  onClose,
  onReload,
  onSubmit,
}: ChoiceSetEditorDrawerViewProps) {
  const submission = buildChoiceSetEditorSubmission(session)
  const codeInvalid =
    session.mode === 'create' &&
    session.draft.code !== '' &&
    (session.draft.code.length > 64 || !isUrlSafeChoiceCode(session.draft.code))
  const displayNameInvalid =
    session.validationMessage !== null && session.draft.displayName.trim() === ''

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Drawer
      open={session.open}
      title={session.mode === 'create' ? '새 선택지 집합' : '선택지 집합 수정'}
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
            form="choice-set-editor-form"
            type="submit"
            loading={pending}
            disabled={
              pending || submission === null || session.conflict !== null
            }
          >
            {session.conflict || session.rebased ? '다시 저장' : '저장'}
          </Button>
        </>
      }
    >
      <form id="choice-set-editor-form" className="space-y-4" onSubmit={submit}>
        {session.conflict ? (
          <InlineAlert tone="warning">
            다른 관리자가 버전 {session.conflict.version}로 변경했습니다. 현재 초안은 그대로
            유지됩니다. 최신 버전을 확인한 뒤 명시적으로 다시 저장하세요.
          </InlineAlert>
        ) : null}
        {mutationError ? (
          <InlineAlert tone="error">
            저장하지 못했습니다. 초안은 유지됩니다. {getApiErrorMessage(mutationError)}
          </InlineAlert>
        ) : null}
        {session.validationMessage ? (
          <InlineAlert tone="error">{session.validationMessage}</InlineAlert>
        ) : null}

        <Field
          inputId="choice-set-code"
          label="Code"
          help={session.mode === 'create' ? CHOICE_CODE_HELP : 'Code는 생성 후 바꿀 수 없습니다.'}
          error={codeInvalid ? CHOICE_CODE_HELP : undefined}
        >
          <input
            className="input font-mono"
            maxLength={64}
            readOnly={session.mode === 'edit'}
            disabled={pending}
            value={session.draft.code}
            onChange={(event) => onChange('code', event.target.value)}
          />
        </Field>
        <Field
          inputId="choice-set-display-name"
          label="표시명"
          error={displayNameInvalid ? '표시명을 입력해 주세요.' : undefined}
        >
          <input
            className="input"
            disabled={pending}
            value={session.draft.displayName}
            onChange={(event) => onChange('displayName', event.target.value)}
          />
        </Field>
        <Field inputId="choice-set-description" label="설명">
          <textarea
            className="min-h-24 w-full rounded-md border border-border-control bg-surface px-3 py-2 text-sm disabled:bg-canvas disabled:opacity-70"
            disabled={pending}
            value={session.draft.description}
            onChange={(event) => onChange('description', event.target.value)}
          />
        </Field>
        {session.mode === 'edit' ? (
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <input
              checked={session.draft.isActive}
              disabled={pending}
              type="checkbox"
              onChange={(event) => onChange('isActive', event.target.checked)}
            />
            선택지 집합 활성화
          </label>
        ) : null}
      </form>
    </Drawer>
  )
}

function isChoiceSetEditorDirty(session: ChoiceSetEditorSession): boolean {
  if (session.mode === 'create') {
    return (
      session.draft.code !== '' ||
      session.draft.displayName !== '' ||
      session.draft.description !== ''
    )
  }
  const original = session.original
  return (
    original !== null &&
    (session.draft.displayName !== original.display_name ||
      session.draft.description !== (original.description ?? '') ||
      session.draft.isActive !== original.is_active)
  )
}
