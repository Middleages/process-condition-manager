import { queryOptions, useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { getApiErrorMessage } from '@/api/client'
import { listChoiceSets } from '@/api/choiceSets'
import type { ChoiceSetSummaryOut } from '@/api/types'
import { Badge } from '@/shared/components/Badge'
import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { PageHeader } from '@/shared/components/PageHeader'

import {
  ChoiceSetEditorDrawer,
  choiceSetEditorSessionKey,
  type ChoiceSetEditorTarget,
} from './ChoiceSetEditorDrawer'
import { ParameterSectionNav } from './ParameterSectionNav'
import { choiceSetKeys } from './choiceQueries'
import {
  parseChoiceSetListSearch,
  serializeChoiceSetListSearch,
  type ChoiceActiveFilter,
  type ChoiceSetSearchState,
} from './choiceSetUrlState'

export function choiceSetListQueryOptions() {
  return queryOptions({
    queryKey: choiceSetKeys.list(true),
    queryFn: () => listChoiceSets(true),
  })
}

export function filterChoiceSets(
  sets: readonly ChoiceSetSummaryOut[],
  state: ChoiceSetSearchState,
): ChoiceSetSummaryOut[] {
  const query = state.query.trim().toLocaleLowerCase()
  return sets.filter((set) => {
    const activityMatches =
      state.active === 'all' ||
      (state.active === 'active' ? set.is_active : !set.is_active)
    if (!activityMatches) return false
    const searchable = [
      set.code,
      set.display_name,
      set.description ?? '',
      ...set.profile_usage_fields,
    ]
      .join(' ')
      .toLocaleLowerCase()
    return query === '' || searchable.includes(query)
  })
}

export function ChoiceSetListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = parseChoiceSetListSearch(searchParams)
  const [queryDraft, setQueryDraft] = useState(state.query)
  const [editor, setEditor] = useState<ChoiceSetEditorTarget | null>(null)
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const query = useQuery(choiceSetListQueryOptions())
  const rows = filterChoiceSets(query.data ?? [], state)

  useEffect(() => setQueryDraft(state.query), [state.query])

  useEffect(() => {
    if (queryDraft === state.query) return
    const timeout = window.setTimeout(() => {
      setSearchParams(
        serializeChoiceSetListSearch({ ...state, query: queryDraft }),
        { replace: true },
      )
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [queryDraft, setSearchParams, state])

  function changeActive(active: ChoiceActiveFilter) {
    setSearchParams(serializeChoiceSetListSearch({ ...state, active }))
  }

  return (
    <section className="space-y-5">
      <ParameterSectionNav />
      <ChoiceSetListRouteHeader onCreate={() => setEditor({ kind: 'create' })} />
      {query.isPending ? (
        <InlineAlert tone="info">선택지 집합 목록을 불러오는 중입니다.</InlineAlert>
      ) : null}
      {query.isError ? (
        <InlineAlert className="flex items-center justify-between gap-3" tone="error">
          <span>선택지 집합을 불러오지 못했습니다. {getApiErrorMessage(query.error)}</span>
          <Button size="compact" variant="secondary" onClick={() => query.refetch()}>
            다시 시도
          </Button>
        </InlineAlert>
      ) : null}
      {!query.isPending && !query.isError ? (
        <ChoiceSetListView
          rows={rows}
          state={state}
          queryDraft={queryDraft}
          listHeadingRef={listHeadingRef}
          onEdit={(summary) => setEditor({ kind: 'edit', summary })}
          onQueryChange={setQueryDraft}
          onActiveChange={changeActive}
        />
      ) : null}
      {editor ? (
        <ChoiceSetEditorDrawer
          key={choiceSetEditorSessionKey(editor)}
          target={editor}
          fallbackFocusRef={listHeadingRef}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </section>
  )
}

export function ChoiceSetListRouteHeader({
  onCreate,
}: {
  onCreate: () => void
}) {
  return (
    <PageHeader
      title="선택지 집합"
      description="업무용 선택지를 한 번 정의하고 파라미터와 Project Profile에서 공유합니다."
      actions={
        <Button type="button" onClick={onCreate}>
          <Plus aria-hidden="true" size={16} />
          새 선택지 집합
        </Button>
      }
    />
  )
}

export interface ChoiceSetListViewProps {
  rows: readonly ChoiceSetSummaryOut[]
  state: ChoiceSetSearchState
  queryDraft: string
  listHeadingRef?: React.RefObject<HTMLHeadingElement>
  onEdit: (summary: ChoiceSetSummaryOut) => void
  onQueryChange: (query: string) => void
  onActiveChange: (active: ChoiceActiveFilter) => void
}

export function ChoiceSetListView({
  rows,
  state,
  queryDraft,
  listHeadingRef,
  onEdit,
  onQueryChange,
  onActiveChange,
}: ChoiceSetListViewProps) {
  return (
    <div className="space-y-5">
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
              placeholder="code, 표시명, Profile 필드"
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
            <option value="active">활성</option>
            <option value="all">전체</option>
            <option value="inactive">비활성</option>
          </select>
        </label>
      </div>

      <section aria-labelledby="choice-set-list-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2
            ref={listHeadingRef}
            id="choice-set-list-heading"
            className="rounded-sm text-lg font-bold text-ink-950 focus:outline-2 focus:outline-offset-2 focus:outline-brand-700"
            tabIndex={-1}
          >
            집합 목록
          </h2>
          <p className="text-sm font-medium tabular-nums text-muted">{rows.length}개</p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-control bg-surface px-5 py-8 text-center">
            <p className="font-semibold text-ink-950">조건에 맞는 선택지 집합이 없습니다.</p>
            <p className="mt-1 text-sm text-muted">검색어나 상태 필터를 바꿔 보세요.</p>
          </div>
        ) : (
          <div className="min-w-0 overflow-x-auto rounded-xl border border-border-subtle bg-surface">
            <table className="w-full min-w-[1160px] table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[16%]" />
                <col className="w-[8%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[16%]" />
                <col className="w-[7%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead className="bg-canvas text-xs font-semibold text-muted">
                <tr className="h-9">
                  <th className="px-3" scope="col">Code</th>
                  <th className="px-3" scope="col">표시명</th>
                  <th className="px-3" scope="col">상태</th>
                  <th className="px-3" scope="col">전체 / 활성</th>
                  <th className="px-3" scope="col">파라미터 사용</th>
                  <th className="px-3" scope="col">Profile 사용</th>
                  <th className="px-3" scope="col">버전</th>
                  <th className="px-3" scope="col">업데이트</th>
                  <th
                    className="sticky right-0 border-l border-border-subtle bg-canvas px-3 text-right shadow-[-6px_0_8px_-8px_rgb(15_23_42_/_0.45)]"
                    scope="col"
                  >
                    작업
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((set) => (
                  <tr
                    key={set.code}
                    className="h-9 shadow-[inset_0_1px_0_var(--color-border-subtle)]"
                  >
                    <td className="min-w-0 overflow-hidden px-3">
                      <Link
                        className="block truncate font-mono text-xs font-semibold text-brand-700 hover:underline"
                        title={set.code}
                        to={`/parameters/choice-sets/${encodeURIComponent(set.code)}`}
                      >
                        {set.code}
                      </Link>
                    </td>
                    <td className="min-w-0 overflow-hidden px-3">
                      <span className="block truncate font-medium" title={set.display_name}>
                        {set.display_name}
                      </span>
                    </td>
                    <td className="px-3">
                      <Badge
                        className="whitespace-nowrap"
                        tone={set.is_active ? 'draft' : 'warning'}
                      >
                        {set.is_active ? '활성' : '사용 중지됨'}
                      </Badge>
                    </td>
                    <td className="px-3 tabular-nums text-muted">
                      {set.option_count} / {set.active_option_count}
                    </td>
                    <td className="px-3 tabular-nums text-muted">{set.parameter_usage_count}곳</td>
                    <td className="min-w-0 overflow-hidden px-3 text-xs text-muted">
                      <span
                        className="block truncate"
                        title={set.profile_usage_fields.join(', ') || '없음'}
                      >
                        {set.profile_usage_fields.join(', ') || '없음'}
                      </span>
                    </td>
                    <td className="px-3 font-mono text-xs text-muted">v{set.version}</td>
                    <td className="px-3 text-xs text-muted">
                      <time dateTime={set.updated_at}>{formatUpdatedAt(set.updated_at)}</time>
                    </td>
                    <td className="sticky right-0 border-l border-border-subtle bg-surface px-3 text-right shadow-[-6px_0_8px_-8px_rgb(15_23_42_/_0.45)]">
                      <Button
                        aria-label={`${set.code} 메타데이터 수정`}
                        size="compact"
                        type="button"
                        variant="ghost"
                        onClick={() => onEdit(set)}
                      >
                        수정
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
}
