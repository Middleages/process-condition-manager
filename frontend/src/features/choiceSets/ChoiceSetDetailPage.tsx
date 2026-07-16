import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  FileUp,
  Pencil,
  Plus,
  Search,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import {
  getApiErrorMessage,
  getChoiceSetChangedSummary,
} from '@/api/client'
import {
  fetchAllChoiceOptions,
  getChoiceSet,
  reorderChoiceOptions,
} from '@/api/choiceSets'
import type {
  ChoiceOptionOrderIn,
  ChoiceOptionOut,
  ChoiceSetSummaryOut,
} from '@/api/types'
import { Badge } from '@/shared/components/Badge'
import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { PageHeader } from '@/shared/components/PageHeader'
import { useUnsavedChanges } from '@/shared/navigation/useUnsavedChanges'

import {
  filterChoiceOptions,
  isExactChoiceSetAdminSnapshot,
  loadExactChoiceSetAdminSnapshot,
  moveOption,
  resetChoiceMutationErrors,
  toOrderPayload,
  type ChoiceSetAdminSnapshot,
} from './choiceSetAdminState'
import {
  ChoiceOptionEditorDialog,
  type ChoiceOptionEditorTarget,
} from './ChoiceOptionEditorDialog'
import { ChoiceImportDialog } from './ChoiceImportDialog'
import {
  ChoiceSetEditorDrawer,
  choiceSetEditorSessionKey,
  type ChoiceSetEditorTarget,
} from './ChoiceSetEditorDrawer'
import { ParameterSectionNav } from './ParameterSectionNav'
import {
  choiceOptionQueryOptions,
  choiceSetKeys,
  invalidateChoiceSetMutation,
  summaryQueryOptions,
} from './choiceQueries'
import {
  parseChoiceSetDetailSearch,
  serializeChoiceSetDetailSearch,
  type ChoiceActiveFilter,
  type ChoiceSetSearchState,
} from './choiceSetUrlState'

export interface ChoiceOrderSession {
  baseVersion: number
  orderedOptions: ChoiceOptionOut[]
  conflict: ChoiceSetSummaryOut | null
  dirty: boolean
  rebased: boolean
}

type ChoiceOrderAction =
  | { type: 'move'; code: string; delta: -1 | 1 }
  | { type: 'conflict'; latest: ChoiceSetSummaryOut }
  | { type: 'save-success'; summary: ChoiceSetSummaryOut }
  | { type: 'reload-latest'; snapshot: ChoiceSetAdminSnapshot }

export interface ChoiceReorderSubmission {
  setCode: string
  payload: ChoiceOptionOrderIn
}

export interface ChoiceSetAdminSessionOwner<T> {
  setCode: string
  snapshot: ChoiceSetAdminSnapshot
  session: T
}

export function ownChoiceSetAdminSession<T>(
  snapshot: ChoiceSetAdminSnapshot,
  session: T,
): ChoiceSetAdminSessionOwner<T> {
  return {
    setCode: snapshot.summary.code,
    snapshot,
    session,
  }
}

export function choiceSetAdminSessionForRoute<T>(
  owner: ChoiceSetAdminSessionOwner<T> | null,
  setCode: string,
): ChoiceSetAdminSessionOwner<T> | null {
  return owner?.setCode === setCode ? owner : null
}

export function startChoiceOrderSession(
  snapshot: ChoiceSetAdminSnapshot,
): ChoiceOrderSession {
  return {
    baseVersion: snapshot.summary.version,
    orderedOptions: [...snapshot.aggregate.items],
    conflict: null,
    dirty: false,
    rebased: false,
  }
}

export function choiceOrderReducer(
  state: ChoiceOrderSession,
  action: ChoiceOrderAction,
): ChoiceOrderSession {
  switch (action.type) {
    case 'move':
      return {
        ...state,
        orderedOptions: moveOption(
          state.orderedOptions,
          action.code,
          action.delta,
        ),
        dirty: true,
      }
    case 'conflict':
      return { ...state, conflict: action.latest }
    case 'save-success':
      return {
        ...state,
        baseVersion: action.summary.version,
        conflict: null,
        dirty: false,
        rebased: false,
      }
    case 'reload-latest': {
      const latestByCode = new Map(
        action.snapshot.aggregate.items.map((option) => [option.code, option]),
      )
      const sameCodeSet =
        latestByCode.size === state.orderedOptions.length &&
        state.orderedOptions.every((option) => latestByCode.has(option.code))
      return {
        baseVersion: action.snapshot.summary.version,
        orderedOptions: sameCodeSet
          ? state.orderedOptions.map(
              (option) => latestByCode.get(option.code) as ChoiceOptionOut,
            )
          : [...action.snapshot.aggregate.items],
        conflict: null,
        dirty: sameCodeSet ? state.dirty : false,
        rebased: sameCodeSet && state.dirty,
      }
    }
  }
}

export function hasUnsavedChoiceOrder(order: ChoiceOrderSession | null): boolean {
  return order !== null && (order.dirty || order.conflict !== null)
}

export function isChoiceReorderAvailable(state: ChoiceSetSearchState): boolean {
  return state.query.trim() === '' && state.active === 'all'
}

export function buildChoiceReorderSubmission(
  order: ChoiceOrderSession,
  snapshot: ChoiceSetAdminSnapshot,
  state: ChoiceSetSearchState,
  pending: boolean,
): ChoiceReorderSubmission | null {
  if (
    pending ||
    order.conflict !== null ||
    !order.dirty ||
    !isChoiceReorderAvailable(state) ||
    order.baseVersion !== snapshot.summary.version ||
    !isExactChoiceSetAdminSnapshot(snapshot.summary, snapshot.aggregate, true)
  ) {
    return null
  }
  const orderedCodes = order.orderedOptions.map((option) => option.code)
  const aggregateCodes = new Set(
    snapshot.aggregate.items.map((option) => option.code),
  )
  if (
    orderedCodes.length !== aggregateCodes.size ||
    new Set(orderedCodes).size !== orderedCodes.length ||
    orderedCodes.some((code) => !aggregateCodes.has(code))
  ) {
    return null
  }
  return {
    setCode: snapshot.summary.code,
    payload: toOrderPayload(order.baseVersion, order.orderedOptions),
  }
}

export function ChoiceSetDetailPage() {
  const { setCode = '' } = useParams<{ setCode: string }>()
  return createChoiceSetDetailOwnerElement(setCode)
}

export function createChoiceSetDetailOwnerElement(setCode: string) {
  return <ChoiceSetDetailRouteOwner key={setCode} setCode={setCode} />
}

function ChoiceSetDetailRouteOwner({ setCode }: { setCode: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = parseChoiceSetDetailSearch(searchParams)
  const [queryDraft, setQueryDraft] = useState(state.query)
  const [visibleLimit, setVisibleLimit] = useState(100)
  const [editorOwner, setEditorOwner] = useState<
    ChoiceSetAdminSessionOwner<ChoiceOptionEditorTarget> | null
  >(null)
  const [metadataEditor, setMetadataEditor] =
    useState<ChoiceSetEditorTarget | null>(null)
  const [importOwner, setImportOwner] = useState<
    ChoiceSetAdminSessionOwner<true> | null
  >(null)
  const [order, setOrder] = useState<ChoiceOrderSession | null>(null)
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const queryClient = useQueryClient()

  const summaryQuery = useQuery(summaryQueryOptions(setCode))
  const summaryVersion = summaryQuery.data?.version ?? 1
  const optionsQuery = useQuery({
    ...choiceOptionQueryOptions(queryClient, setCode, summaryVersion, true),
    enabled: summaryQuery.isSuccess,
  })
  const snapshot = exactSnapshot(summaryQuery.data, optionsQuery.data)

  useEffect(() => setQueryDraft(state.query), [state.query])
  useEffect(() => setVisibleLimit(100), [state.active, state.query])

  useEffect(() => {
    if (queryDraft === state.query) return
    const timeout = window.setTimeout(() => {
      setSearchParams(
        serializeChoiceSetDetailSearch({ ...state, query: queryDraft }),
        { replace: true },
      )
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [queryDraft, setSearchParams, state])

  useEffect(() => {
    if (!snapshot) return
    setOrder((current) => {
      if (current === null || (!current.dirty && current.conflict === null)) {
        return startChoiceOrderSession(snapshot)
      }
      if (
        current.baseVersion !== snapshot.summary.version &&
        current.conflict === null
      ) {
        return choiceOrderReducer(current, {
          type: 'conflict',
          latest: snapshot.summary,
        })
      }
      return current
    })
  }, [snapshot?.aggregate, snapshot?.summary])

  const reorderMutation = useMutation<
    ChoiceSetSummaryOut,
    unknown,
    ChoiceReorderSubmission
  >({
    mutationFn: (submission) =>
      reorderChoiceOptions(submission.setCode, submission.payload),
    onSuccess: async (updatedSummary) => {
      setOrder((current) =>
        current
          ? choiceOrderReducer(current, {
              type: 'save-success',
              summary: updatedSummary,
            })
          : current,
      )
      await invalidateChoiceSetMutation(queryClient, updatedSummary.code)
    },
    onError: (error) => {
      const latest = getChoiceSetChangedSummary(error)
      if (latest) {
        setOrder((current) =>
          current
            ? choiceOrderReducer(current, { type: 'conflict', latest })
            : current,
        )
      }
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
      queryClient.setQueryData(
        choiceSetKeys.summary(setCode),
        nextSnapshot.summary,
      )
      queryClient.setQueryData(
        choiceSetKeys.options(setCode, nextSnapshot.summary.version, true),
        nextSnapshot.aggregate,
      )
      setOrder((current) =>
        current
          ? choiceOrderReducer(current, {
              type: 'reload-latest',
              snapshot: nextSnapshot,
            })
          : startChoiceOrderSession(nextSnapshot),
      )
    },
  })

  function changeActive(active: ChoiceActiveFilter) {
    setSearchParams(serializeChoiceSetDetailSearch({ ...state, active }))
  }

  function reorder(code: string, delta: -1 | 1) {
    if (!snapshot || !order || reorderMutation.isPending || reloadMutation.isPending) return
    const moved = choiceOrderReducer(order, { type: 'move', code, delta })
    setOrder(moved)
    const submission = buildChoiceReorderSubmission(moved, snapshot, state, false)
    if (submission) reorderMutation.mutate(submission)
  }

  function retryReorder() {
    if (!snapshot || !order) return
    const submission = buildChoiceReorderSubmission(
      order,
      snapshot,
      state,
      reorderMutation.isPending || reloadMutation.isPending,
    )
    if (submission) reorderMutation.mutate(submission)
  }

  function reloadLatestOrder() {
    resetChoiceMutationErrors(reorderMutation.reset, reloadMutation.reset)
    reloadMutation.mutate()
  }

  function openOptionEditor(target: ChoiceOptionEditorTarget) {
    if (!snapshot) return
    setEditorOwner(ownChoiceSetAdminSession(snapshot, target))
  }

  function openImport() {
    if (!snapshot) return
    setImportOwner(ownChoiceSetAdminSession(snapshot, true))
  }

  const summary = summaryQuery.data
  const routedEditorOwner = choiceSetAdminSessionForRoute(editorOwner, setCode)
  const routedImportOwner = choiceSetAdminSessionForRoute(importOwner, setCode)
  const displayOptions = order?.orderedOptions ?? snapshot?.aggregate.items ?? []
  const filteredOptions = filterChoiceOptions(displayOptions, state)
  const pending = reorderMutation.isPending || reloadMutation.isPending
  const reorderDisabled =
    !snapshot ||
    !order ||
    pending ||
    order.conflict !== null ||
    !isChoiceReorderAvailable(state)

  useUnsavedChanges({
    when: hasUnsavedChoiceOrder(order),
    freezeWhen: pending,
    message: '저장되지 않은 전체 선택지 순서가 있습니다. 순서 초안을 버리고 이동할까요?',
  })

  return (
    <section className="space-y-5">
      <ParameterSectionNav />
      <ChoiceSetDetailRouteHeader
        setCode={setCode}
        summary={summary}
        onAdd={() => openOptionEditor({ kind: 'create' })}
        onEditSet={() => {
          if (summary) setMetadataEditor({ kind: 'edit', summary })
        }}
        onImport={openImport}
      />

      {summaryQuery.isPending ? (
        <InlineAlert tone="info">선택지 집합 정보를 불러오는 중입니다.</InlineAlert>
      ) : null}
      {summaryQuery.isError ? (
        <InlineAlert tone="error">
          선택지 집합을 불러오지 못했습니다. {getApiErrorMessage(summaryQuery.error)}
        </InlineAlert>
      ) : null}
      {summary ? (
        <ChoiceSetDetailView
          summary={summary}
          options={filteredOptions}
          state={state}
          queryDraft={queryDraft}
          visibleLimit={visibleLimit}
          listHeadingRef={listHeadingRef}
          reorderDisabled={reorderDisabled}
          onActiveChange={changeActive}
          onDeactivate={(option) =>
            openOptionEditor({ kind: 'deactivate', option })
          }
          onEdit={(option) => openOptionEditor({ kind: 'edit', option })}
          onLoadMore={() => setVisibleLimit((current) => current + 100)}
          onQueryChange={setQueryDraft}
          onReorder={reorder}
        />
      ) : null}

      {summaryQuery.isSuccess && optionsQuery.isPending ? (
        <InlineAlert tone="info">활성·비활성 선택지 전체를 불러오는 중입니다.</InlineAlert>
      ) : null}
      {optionsQuery.isError ? (
        <InlineAlert tone="error">
          전체 선택지 목록을 불러오지 못했습니다. {getApiErrorMessage(optionsQuery.error)}
        </InlineAlert>
      ) : null}
      {summaryQuery.data && optionsQuery.data && !snapshot ? (
        <InlineAlert tone="warning">
          요약 버전과 전체 선택지 목록이 일치하지 않아 관리 작업을 잠갔습니다. 다시
          불러오세요.
        </InlineAlert>
      ) : null}
      {order?.conflict ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3" tone="warning">
          <span>
            다른 관리자가 버전 {order.conflict.version}로 변경했습니다. 순서 초안은 그대로
            유지됩니다.
          </span>
          <Button
            size="compact"
            variant="secondary"
            loading={reloadMutation.isPending}
            disabled={reorderMutation.isPending}
            onClick={reloadLatestOrder}
          >
            최신 버전 불러오기
          </Button>
        </InlineAlert>
      ) : null}
      {order?.rebased && order.dirty ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3" tone="info">
          <span>최신 전체 코드와 순서 초안을 확인했습니다. 다시 저장할 수 있습니다.</span>
          <Button size="compact" disabled={pending} onClick={retryReorder}>
            순서 다시 저장
          </Button>
        </InlineAlert>
      ) : null}
      {reorderMutation.error && !order?.conflict ? (
        <InlineAlert tone="error">
          순서를 저장하지 못했습니다. 순서 초안은 유지됩니다.{' '}
          {getApiErrorMessage(reorderMutation.error)}
        </InlineAlert>
      ) : null}
      {reloadMutation.error ? (
        <InlineAlert tone="error">
          최신 전체 목록을 불러오지 못했습니다. {getApiErrorMessage(reloadMutation.error)}
        </InlineAlert>
      ) : null}

      {routedEditorOwner ? (
        <ChoiceOptionEditorDialog
          key={`${routedEditorOwner.session.kind}-${
            routedEditorOwner.session.kind === 'create'
              ? 'new'
              : routedEditorOwner.session.option.code
          }`}
          setCode={routedEditorOwner.setCode}
          summary={routedEditorOwner.snapshot.summary}
          aggregate={routedEditorOwner.snapshot.aggregate}
          observedSummary={summary}
          observedSnapshot={snapshot}
          target={routedEditorOwner.session}
          fallbackFocusRef={listHeadingRef}
          onClose={() => setEditorOwner(null)}
        />
      ) : null}
      {routedImportOwner ? (
        <ChoiceImportDialog
          key={`import-${routedImportOwner.setCode}`}
          snapshot={routedImportOwner.snapshot}
          observedSummary={summary}
          observedSnapshot={snapshot}
          fallbackFocusRef={listHeadingRef}
          onClose={() => setImportOwner(null)}
        />
      ) : null}
      {metadataEditor ? (
        <ChoiceSetEditorDrawer
          key={choiceSetEditorSessionKey(metadataEditor)}
          target={metadataEditor}
          fallbackFocusRef={listHeadingRef}
          onClose={() => setMetadataEditor(null)}
        />
      ) : null}
    </section>
  )
}

export interface ChoiceSetDetailRouteHeaderProps {
  setCode: string
  summary?: ChoiceSetSummaryOut
  onAdd: () => void
  onEditSet: () => void
  onImport: () => void
}

export function ChoiceSetDetailRouteHeader({
  setCode,
  summary,
  onAdd,
  onEditSet,
  onImport,
}: ChoiceSetDetailRouteHeaderProps) {
  return (
    <div className="space-y-5">
      <Link
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
        to="/parameters/choice-sets"
      >
        <ArrowLeft aria-hidden="true" size={16} />
        선택지 집합 목록
      </Link>
      <PageHeader
        eyebrow={
          <span className="font-mono">
            {summary ? `${summary.code} · v${summary.version}` : setCode}
          </span>
        }
        title={summary?.display_name ?? '선택지 집합'}
        description={
          summary
            ? summary.description ?? '설명이 없습니다.'
            : '선택지 집합 정보를 불러오고 있습니다.'
        }
        actions={
          summary ? (
            <>
              <Button type="button" variant="secondary" onClick={onEditSet}>
                <Pencil aria-hidden="true" size={16} />
                집합 정보 수정
              </Button>
              <Button type="button" variant="secondary" onClick={onImport}>
                <FileUp aria-hidden="true" size={16} />
                CSV 가져오기
              </Button>
              <Button type="button" onClick={onAdd}>
                <Plus aria-hidden="true" size={16} />
                선택지 추가
              </Button>
            </>
          ) : null
        }
      />
    </div>
  )
}

export interface ChoiceSetDetailViewProps {
  summary: ChoiceSetSummaryOut
  options: readonly ChoiceOptionOut[]
  state: ChoiceSetSearchState
  queryDraft: string
  visibleLimit: number
  listHeadingRef?: React.RefObject<HTMLHeadingElement>
  reorderDisabled?: boolean
  onActiveChange: (active: ChoiceActiveFilter) => void
  onDeactivate: (option: ChoiceOptionOut) => void
  onEdit: (option: ChoiceOptionOut) => void
  onLoadMore: () => void
  onQueryChange: (query: string) => void
  onReorder: (code: string, delta: -1 | 1) => void
}

export function ChoiceSetDetailView({
  summary,
  options,
  state,
  queryDraft,
  visibleLimit,
  listHeadingRef,
  reorderDisabled = false,
  onActiveChange,
  onDeactivate,
  onEdit,
  onLoadMore,
  onQueryChange,
  onReorder,
}: ChoiceSetDetailViewProps) {
  const rows = options.slice(0, visibleLimit)
  const filterBlocksReorder = !isChoiceReorderAvailable(state)
  const disableAllReorder = reorderDisabled || filterBlocksReorder
  return (
    <div className="space-y-5">
      <section
        aria-label="사용 및 영향 범위"
        className="grid gap-3 rounded-xl border border-border-subtle bg-surface p-4 md:grid-cols-3"
      >
        <div>
          <p className="text-xs font-semibold text-muted">집합 상태</p>
          <Badge
            className="mt-1 whitespace-nowrap"
            tone={summary.is_active ? 'draft' : 'warning'}
          >
            {summary.is_active ? '활성' : '사용 중지됨'}
          </Badge>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted">파라미터 영향</p>
          <p className="mt-1 font-semibold text-ink-950">파라미터 {summary.parameter_usage_count}곳</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">고정 Project Profile 영향</p>
          <p className="mt-1 text-sm font-semibold text-ink-950">
            고정 Profile 필드 {summary.profile_usage_fields.length}곳
          </p>
          <p className="mt-1 break-words font-mono text-xs text-muted">
            {summary.profile_usage_fields.join(', ') || '없음'}
          </p>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-[minmax(260px,1fr)_180px]">
        <label className="grid gap-1.5 text-sm font-semibold text-ink-950">
          검색
          <span className="relative block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              size={16}
            />
            <input
              className="input pl-9"
              placeholder="code 또는 표시명"
              type="search"
              value={queryDraft}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </span>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-ink-950">
          상태
          <select
            className="input"
            value={state.active}
            onChange={(event) =>
              onActiveChange(event.target.value as ChoiceActiveFilter)
            }
          >
            <option value="all">전체</option>
            <option value="active">활성</option>
            <option value="inactive">비활성</option>
          </select>
        </label>
      </div>

      {filterBlocksReorder ? (
        <InlineAlert tone="info">
          검색과 상태 필터를 해제해야 전체 순서를 바꿀 수 있습니다. 순서 저장은 활성·비활성
          모든 코드를 한 번에 전송합니다.
        </InlineAlert>
      ) : null}

      <section aria-labelledby="choice-option-list-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2
            ref={listHeadingRef}
            id="choice-option-list-heading"
            className="rounded-sm text-lg font-bold text-ink-950 focus:outline-2 focus:outline-offset-2 focus:outline-brand-700"
            tabIndex={-1}
          >
            선택지 목록
          </h2>
          <p className="text-sm font-medium tabular-nums text-muted">
            {options.length}개
          </p>
        </div>
        <div className="min-w-0 overflow-x-auto rounded-xl border border-border-subtle bg-surface">
          <table className="w-full min-w-[760px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[30%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[22%]" />
            </colgroup>
            <thead className="bg-canvas text-xs font-semibold text-muted">
              <tr className="h-9">
                <th className="px-3" scope="col">Code</th>
                <th className="px-3" scope="col">표시명</th>
                <th className="px-3" scope="col">상태</th>
                <th className="px-3" scope="col">순서</th>
                <th className="px-3 text-right" scope="col">작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((option, index) => (
                <tr
                  key={option.code}
                  className="h-9 shadow-[inset_0_1px_0_var(--color-border-subtle)]"
                >
                  <td className="min-w-0 overflow-hidden px-3">
                    <span className="block truncate font-mono text-xs font-semibold text-brand-700">
                      {option.code}
                    </span>
                  </td>
                  <td className="min-w-0 overflow-hidden px-3">
                    <span className="block truncate font-medium" title={option.label}>{option.label}</span>
                  </td>
                  <td className="px-3">
                    <Badge
                      className="whitespace-nowrap"
                      tone={option.is_active ? 'draft' : 'warning'}
                    >
                      {option.is_active ? '활성' : '사용 중지됨'}
                    </Badge>
                  </td>
                  <td className="px-3">
                    <div className="flex items-center gap-1">
                      <Button
                        aria-label={`${option.code} 위로`}
                        size="compact"
                        type="button"
                        variant="ghost"
                        disabled={disableAllReorder || index === 0}
                        onClick={() => onReorder(option.code, -1)}
                      >
                        <ArrowUp aria-hidden="true" size={14} />
                      </Button>
                      <Button
                        aria-label={`${option.code} 아래로`}
                        size="compact"
                        type="button"
                        variant="ghost"
                        disabled={disableAllReorder || index === options.length - 1}
                        onClick={() => onReorder(option.code, 1)}
                      >
                        <ArrowDown aria-hidden="true" size={14} />
                      </Button>
                    </div>
                  </td>
                  <td className="px-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="compact" type="button" variant="ghost" onClick={() => onEdit(option)}>
                        수정
                      </Button>
                      {option.is_active ? (
                        <Button size="compact" type="button" variant="danger" onClick={() => onDeactivate(option)}>
                          사용 중지
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {options.length > visibleLimit ? (
          <div className="flex justify-center">
            <Button type="button" variant="secondary" onClick={onLoadMore}>
              더 보기 ({Math.min(100, options.length - visibleLimit)}개)
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function exactSnapshot(
  summary: ChoiceSetSummaryOut | undefined,
  aggregate: ChoiceSetAdminSnapshot['aggregate'] | undefined,
): ChoiceSetAdminSnapshot | null {
  if (!summary || !aggregate) return null
  return isExactChoiceSetAdminSnapshot(summary, aggregate, true)
    ? { summary, aggregate }
    : null
}
