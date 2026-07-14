import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Dispatch, RefObject } from 'react'
import { useReducer, useState } from 'react'

import {
  getApiErrorMessage,
  getChoiceSetChangedSummary,
} from '@/api/client'
import {
  applyChoiceImport,
  fetchAllChoiceOptions,
  getChoiceSet,
  previewChoiceImport,
} from '@/api/choiceSets'
import type {
  ChoiceImportIn,
  ChoiceImportPreviewOut,
  ChoiceSetSummaryOut,
} from '@/api/types'
import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { Dialog } from '@/shared/components/ModalSurface'
import { useUnsavedChanges } from '@/shared/navigation/useUnsavedChanges'

import {
  canApplyChoicePreview,
  completeChoiceSetMutation,
  isCurrentChoicePreview,
  isExactChoiceSetAdminSnapshot,
  loadExactChoiceSetAdminSnapshot,
  resetChoiceMutationErrors,
  type ChoicePreviewSnapshot,
  type ChoiceSetAdminSnapshot,
} from './choiceSetAdminState'
import {
  choiceSetKeys,
  invalidateChoiceSetMutation,
} from './choiceQueries'

export interface ChoiceImportPreviewRequest {
  generation: number
  csvText: string
  baseVersion: number
  payload: ChoiceImportIn
}

export interface ChoiceImportSession {
  csvText: string
  preview: ChoicePreviewSnapshot | null
  conflict: ChoiceSetSummaryOut | null
  previewGeneration: number
}

type ChoiceImportAction =
  | { type: 'change-csv'; csvText: string }
  | { type: 'preview-start'; request: ChoiceImportPreviewRequest }
  | {
      type: 'preview-success'
      baseVersion: number
      response: ChoiceImportPreviewOut
    }
  | {
      type: 'preview-settle'
      request: ChoiceImportPreviewRequest
      response: ChoiceImportPreviewOut
    }
  | { type: 'conflict'; latest: ChoiceSetSummaryOut }
  | { type: 'reload-latest' }

export function startChoiceImportSession(): ChoiceImportSession {
  return {
    csvText: '',
    preview: null,
    conflict: null,
    previewGeneration: 0,
  }
}

export function choiceImportReducer(
  state: ChoiceImportSession,
  action: ChoiceImportAction,
): ChoiceImportSession {
  switch (action.type) {
    case 'change-csv':
      return { ...state, csvText: action.csvText }
    case 'preview-start':
      return {
        ...state,
        previewGeneration: Math.max(
          state.previewGeneration,
          action.request.generation,
        ),
      }
    case 'preview-success':
      return {
        ...state,
        preview: {
          csvText: state.csvText,
          baseVersion: action.baseVersion,
          response: action.response,
        },
        conflict: null,
      }
    case 'preview-settle':
      return settleChoiceImportPreview(state, action.request, action.response)
    case 'conflict':
      return { ...state, conflict: action.latest }
    case 'reload-latest':
      return { ...state, conflict: null }
  }
}

export function beginChoiceImportPreview(
  session: ChoiceImportSession,
  baseVersion: number,
): ChoiceImportPreviewRequest {
  return {
    generation: session.previewGeneration + 1,
    csvText: session.csvText,
    baseVersion,
    payload: { expected_version: baseVersion, csv_text: session.csvText },
  }
}

export function settleChoiceImportPreview(
  session: ChoiceImportSession,
  request: ChoiceImportPreviewRequest,
  response: ChoiceImportPreviewOut,
): ChoiceImportSession {
  if (
    request.generation !== session.previewGeneration ||
    request.csvText !== session.csvText ||
    response.base_version !== request.baseVersion
  ) {
    return session
  }
  return {
    ...session,
    preview: {
      csvText: request.csvText,
      baseVersion: request.baseVersion,
      response,
    },
    conflict: null,
  }
}

export function buildChoiceImportApplyPayload(
  session: ChoiceImportSession,
  currentVersion: number,
): ChoiceImportIn | null {
  const preview = session.preview
  if (
    session.conflict !== null ||
    preview === null ||
    !canApplyChoicePreview(preview, session.csvText, currentVersion)
  ) {
    return null
  }
  return {
    expected_version: preview.baseVersion,
    csv_text: preview.csvText,
  }
}

export interface ChoiceImportDialogProps {
  snapshot: ChoiceSetAdminSnapshot
  fallbackFocusRef: RefObject<HTMLElement>
  onClose: () => void
}

export function ChoiceImportDialog({
  snapshot: initialSnapshot,
  fallbackFocusRef,
  onClose,
}: ChoiceImportDialogProps) {
  const queryClient = useQueryClient()
  const [session, dispatch] = useReducer(
    choiceImportReducer,
    undefined,
    startChoiceImportSession,
  )
  const [snapshot, setSnapshot] = useState(initialSnapshot)

  const previewMutation = useMutation<
    ChoiceImportPreviewOut,
    unknown,
    ChoiceImportPreviewRequest
  >({
    mutationFn: (request) =>
      previewChoiceImport(snapshot.summary.code, request.payload),
    onSuccess: (response, request) => {
      dispatchPreviewSettlement(dispatch, request, response)
    },
    onError: (error) => {
      const latest = getChoiceSetChangedSummary(error)
      if (latest) dispatch({ type: 'conflict', latest })
    },
  })

  const applyMutation = useMutation({
    mutationFn: (payload: ChoiceImportIn) =>
      applyChoiceImport(snapshot.summary.code, payload),
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
      loadExactChoiceSetAdminSnapshot(snapshot.summary.code, {
        loadSummary: getChoiceSet,
        loadAggregate: (code, version) =>
          fetchAllChoiceOptions(code, version, true),
      }),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData(
        choiceSetKeys.summary(nextSnapshot.summary.code),
        nextSnapshot.summary,
      )
      queryClient.setQueryData(
        choiceSetKeys.options(
          nextSnapshot.summary.code,
          nextSnapshot.summary.version,
          true,
        ),
        nextSnapshot.aggregate,
      )
      setSnapshot(nextSnapshot)
      dispatch({ type: 'reload-latest' })
    },
  })

  const pendingAction = previewMutation.isPending
    ? 'preview'
    : applyMutation.isPending
      ? 'apply'
      : reloadMutation.isPending
        ? 'reload'
        : null

  useUnsavedChanges({
    when: session.csvText !== '',
    freezeWhen: pendingAction !== null,
    message: '적용하지 않은 선택지 CSV가 있습니다. 내용을 버리고 이동할까요?',
  })

  function preview() {
    if (
      pendingAction !== null ||
      session.csvText.trim() === '' ||
      session.conflict !== null ||
      !isExactChoiceSetAdminSnapshot(
        snapshot.summary,
        snapshot.aggregate,
        true,
      )
    ) {
      return
    }
    const request = beginChoiceImportPreview(session, snapshot.summary.version)
    dispatch({ type: 'preview-start', request })
    previewMutation.mutate(request)
  }

  function apply() {
    if (
      pendingAction !== null ||
      !isExactChoiceSetAdminSnapshot(
        snapshot.summary,
        snapshot.aggregate,
        true,
      )
    ) {
      return
    }
    const payload = buildChoiceImportApplyPayload(
      session,
      snapshot.summary.version,
    )
    if (payload) applyMutation.mutate(payload)
  }

  return (
    <ChoiceImportDialogView
      session={session}
      currentVersion={snapshot.summary.version}
      pendingAction={pendingAction}
      error={
        session.conflict
          ? null
          : previewMutation.error ?? applyMutation.error ?? reloadMutation.error
      }
      fallbackFocusRef={fallbackFocusRef}
      onApply={apply}
      onChangeCsv={(csvText) => dispatch({ type: 'change-csv', csvText })}
      onClose={onClose}
      onPreview={preview}
      onReload={() => {
        resetChoiceMutationErrors(
          previewMutation.reset,
          applyMutation.reset,
          reloadMutation.reset,
        )
        reloadMutation.mutate()
      }}
    />
  )
}

export interface ChoiceImportDialogViewProps {
  currentVersion: number
  session: ChoiceImportSession
  pendingAction: 'preview' | 'apply' | 'reload' | null
  error?: unknown
  fallbackFocusRef: RefObject<HTMLElement>
  onApply: () => void
  onChangeCsv: (csvText: string) => void
  onClose: () => void
  onPreview: () => void
  onReload: () => void
}

export function ChoiceImportDialogView({
  currentVersion,
  session,
  pendingAction,
  error,
  fallbackFocusRef,
  onApply,
  onChangeCsv,
  onClose,
  onPreview,
  onReload,
}: ChoiceImportDialogViewProps) {
  const applyPayload = buildChoiceImportApplyPayload(session, currentVersion)
  const pending = pendingAction !== null
  return (
    <Dialog
      open
      title="선택지 CSV 가져오기"
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
              loading={pendingAction === 'reload'}
              disabled={pendingAction !== null && pendingAction !== 'reload'}
              onClick={onReload}
            >
              최신 버전 불러오기
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            loading={pendingAction === 'preview'}
            disabled={
              pending || session.csvText.trim() === '' || session.conflict !== null
            }
            onClick={onPreview}
          >
            {session.preview ? '다시 미리보기' : '미리보기'}
          </Button>
          <Button
            type="button"
            loading={pendingAction === 'apply'}
            disabled={pending || applyPayload === null}
            onClick={onApply}
          >
            적용
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label
            className="text-sm font-semibold text-ink-950"
            htmlFor="choice-import-csv"
          >
            CSV
          </label>
          <textarea
            id="choice-import-csv"
            className="mt-1.5 min-h-44 w-full rounded-md border border-border-control bg-surface px-3 py-2 font-mono text-xs disabled:bg-canvas disabled:opacity-70"
            disabled={pending}
            placeholder={'code,label,sort_order,is_active\nAUTO,자동,10,true'}
            value={session.csvText}
            onChange={(event) => onChangeCsv(event.target.value)}
          />
          <p className="mt-1.5 text-xs text-muted">
            미리보기는 저장하지 않습니다. 오류가 0개인 현재 CSV만 한 번에 원자적으로
            적용됩니다.
          </p>
        </div>

        {session.conflict ? (
          <InlineAlert tone="warning">
            다른 관리자가 버전 {session.conflict.version}로 변경했습니다. CSV와 미리보기는
            그대로 유지됩니다. 최신 버전을 불러온 뒤 다시 미리보세요.
          </InlineAlert>
        ) : null}
        {error ? (
          <InlineAlert tone="error">
            요청을 완료하지 못했습니다. CSV는 유지됩니다. {getApiErrorMessage(error)}
          </InlineAlert>
        ) : null}

        {session.preview ? (
          <section aria-labelledby="choice-import-preview-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="choice-import-preview-heading" className="font-bold text-ink-950">
                미리보기 · 버전 {session.preview.baseVersion}
              </h3>
              <p className="text-xs font-semibold tabular-nums text-muted">
                생성 {session.preview.response.created_count} · 수정{' '}
                {session.preview.response.updated_count} · 오류{' '}
                {session.preview.response.error_count}
              </p>
            </div>
            <div className="max-h-56 overflow-auto rounded-lg border border-border-subtle">
              <table className="w-full min-w-[430px] text-left text-xs">
                <thead className="sticky top-0 bg-canvas text-muted">
                  <tr>
                    <th className="px-3 py-2" scope="col">행</th>
                    <th className="px-3 py-2" scope="col">Code</th>
                    <th className="px-3 py-2" scope="col">작업</th>
                    <th className="px-3 py-2" scope="col">결과</th>
                  </tr>
                </thead>
                <tbody>
                  {session.preview.response.rows.map((row) => (
                    <tr key={`${row.line}-${row.code}`} className="border-t border-border-subtle">
                      <td className="px-3 py-2 tabular-nums">{row.line}</td>
                      <td className="px-3 py-2 font-mono">{row.code}</td>
                      <td className="px-3 py-2">{actionLabel(row.action)}</td>
                      <td className="px-3 py-2">{row.message ?? '적용 가능'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!isCurrentChoicePreview(
              session.preview,
              session.csvText,
              currentVersion,
            ) ? (
              <InlineAlert tone="info">
                CSV 내용이나 집합 버전이 미리보기 이후 바뀌었습니다. 다시 미리보세요.
              </InlineAlert>
            ) : session.preview.response.error_count > 0 ? (
              <InlineAlert tone="error">
                오류 행을 수정한 뒤 다시 미리보세요. 오류가 있는 미리보기는 적용할 수
                없습니다.
              </InlineAlert>
            ) : null}
          </section>
        ) : null}
      </div>
    </Dialog>
  )
}

function dispatchPreviewSettlement(
  dispatch: Dispatch<ChoiceImportAction>,
  request: ChoiceImportPreviewRequest,
  response: ChoiceImportPreviewOut,
) {
  dispatch({ type: 'preview-settle', request, response })
}

function actionLabel(action: ChoiceImportPreviewOut['rows'][number]['action']) {
  if (action === 'create') return '생성'
  if (action === 'update') return '수정'
  return '오류'
}
