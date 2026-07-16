import { useQuery } from '@tanstack/react-query'
import { FolderPlus, Plus, Search, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { listCategories } from '@/api/categories'
import { getApiErrorMessage } from '@/api/client'
import { listParameters } from '@/api/parameters'
import type { CategoryOut, ParameterOut, ValueType } from '@/api/types'
import { Badge } from '@/shared/components/Badge'
import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { PageHeader } from '@/shared/components/PageHeader'

import { CategoryCreateDialog } from './CategoryCreateDialog'
import { CsvImportDialog } from './CsvImportDialog'
import { ParameterEditorDrawer } from './ParameterEditorDrawer'
import { ParameterSectionNav } from '../choiceSets/ParameterSectionNav'
import { deriveParameterRegistryRoute } from './parameterAdminState'
import {
  filterParameterRegistry,
  parseParameterRegistrySearch,
  serializeParameterRegistrySearch,
  shouldIncludeInactive,
  type EditTarget,
  type ParameterRegistryState,
} from './registryState'

const VALUE_TYPES: ValueType[] = ['text', 'number', 'choice']

export function ParameterAdminPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const parsedState = parseParameterRegistrySearch(searchParams)
  const includeInactive = shouldIncludeInactive(parsedState.active)
  const [queryDraft, setQueryDraft] = useState(parsedState.query)
  const [csvOpen, setCsvOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const listHeadingRef = useRef<HTMLHeadingElement>(null)

  const parametersQuery = useQuery({
    queryKey: ['parameters', includeInactive],
    queryFn: () => listParameters(includeInactive),
  })
  const categoriesQuery = useQuery({
    queryKey: ['parameter-categories', true],
    queryFn: () => listCategories(true),
  })
  const route = deriveParameterRegistryRoute(
    searchParams,
    categoriesQuery.isSuccess ? categoriesQuery.data : null,
  )
  const state = route.state
  const repairSearch = route.repair?.toString() ?? null
  const rows = filterParameterRegistry(
    parametersQuery.data ?? [],
    categoriesQuery.data ?? [],
    state,
  )

  useEffect(() => {
    setQueryDraft(state.query)
  }, [state.query])

  useEffect(() => {
    if (queryDraft === state.query) return

    const timeout = window.setTimeout(() => {
      setSearchParams(
        serializeParameterRegistrySearch({ ...state, query: queryDraft }),
        { replace: true },
      )
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [queryDraft, setSearchParams, state])

  useEffect(() => {
    if (repairSearch === null) return
    setSearchParams(new URLSearchParams(repairSearch), { replace: true })
  }, [repairSearch, setSearchParams])

  function pushState(next: ParameterRegistryState) {
    setSearchParams(serializeParameterRegistrySearch(next))
  }

  function setFilter<K extends 'category' | 'type' | 'active'>(
    key: K,
    value: ParameterRegistryState[K],
  ) {
    pushState({ ...state, [key]: value })
  }

  function openEditor(edit: EditTarget) {
    pushState({ ...state, edit })
  }

  const editorKey = editTargetKey(state.edit)

  return (
    <section className="space-y-5">
      <ParameterSectionNav />
      <PageHeader
        title="파라미터 레지스트리"
        description="파라미터를 검색하고 목록을 유지한 채 옆에서 생성·수정합니다."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setCsvOpen(true)}>
              <Upload aria-hidden="true" size={16} strokeWidth={2} />
              CSV 가져오기
            </Button>
            <Button type="button" variant="secondary" onClick={() => setCategoryOpen(true)}>
              <FolderPlus aria-hidden="true" size={16} strokeWidth={2} />
              카테고리 추가
            </Button>
            <Button type="button" onClick={() => openEditor({ kind: 'new' })}>
              <Plus aria-hidden="true" size={16} strokeWidth={2} />
              새 파라미터
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(260px,2fr)_minmax(150px,1fr)_minmax(130px,.8fr)_minmax(130px,.8fr)]">
        <label className="grid gap-1.5 text-sm font-semibold text-ink-950">
          검색
          <span className="relative block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              size={16}
              strokeWidth={2}
            />
            <input
              className="input pl-9"
              placeholder="code, 표시명, 카테고리, 단위"
              type="search"
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
            />
          </span>
        </label>

        <label className="grid gap-1.5 text-sm font-semibold text-ink-950">
          카테고리
          <select
            className="input"
            disabled={categoriesQuery.isPending || categoriesQuery.isError}
            value={state.category ?? ''}
            onChange={(event) => setFilter('category', event.target.value || null)}
          >
            <option value="">전체 카테고리</option>
            {(categoriesQuery.data ?? []).map((category) => (
              <option key={category.id} value={category.code}>
                {category.display_name}
                {category.is_active ? '' : ' (비활성)'}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm font-semibold text-ink-950">
          타입
          <select
            className="input"
            value={state.type ?? ''}
            onChange={(event) => setFilter('type', (event.target.value || null) as ValueType | null)}
          >
            <option value="">전체 타입</option>
            {VALUE_TYPES.map((valueType) => (
              <option key={valueType} value={valueType}>
                {valueType}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm font-semibold text-ink-950">
          상태
          <select
            className="input"
            value={state.active}
            onChange={(event) =>
              setFilter('active', event.target.value as ParameterRegistryState['active'])
            }
          >
            <option value="active">활성</option>
            <option value="all">전체</option>
            <option value="inactive">비활성</option>
          </select>
        </label>
      </div>

      {categoriesQuery.isError ? (
        <InlineAlert tone="error">
          카테고리를 불러오지 못했습니다. {getApiErrorMessage(categoriesQuery.error)}
        </InlineAlert>
      ) : null}

      <section aria-labelledby="parameter-list-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2
            ref={listHeadingRef}
            id="parameter-list-heading"
            data-parameter-list-heading
            className="rounded-sm text-lg font-bold text-ink-950 focus:outline-2 focus:outline-offset-2 focus:outline-brand-700"
            tabIndex={-1}
          >
            파라미터 목록
          </h2>
          <p className="text-sm font-medium tabular-nums text-muted">{rows.length}개</p>
        </div>

        {parametersQuery.isPending ? (
          <InlineAlert tone="info">파라미터 목록을 불러오는 중입니다.</InlineAlert>
        ) : null}
        {parametersQuery.isError ? (
          <InlineAlert className="flex flex-wrap items-center justify-between gap-3" tone="error">
            <span>{getApiErrorMessage(parametersQuery.error)}</span>
            <Button size="compact" type="button" variant="secondary" onClick={() => parametersQuery.refetch()}>
              다시 시도
            </Button>
          </InlineAlert>
        ) : null}

        {!parametersQuery.isPending && !parametersQuery.isError ? (
          rows.length > 0 ? (
            <ParameterRegistryTable
              categories={categoriesQuery.data ?? []}
              parameters={rows}
              onEdit={(id) => openEditor({ kind: 'existing', id })}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border-control bg-surface px-5 py-8 text-center">
              <p className="font-semibold text-ink-950">조건에 맞는 파라미터가 없습니다.</p>
              <p className="mt-1 text-sm text-muted">검색어나 필터를 바꿔 보세요.</p>
            </div>
          )
        ) : null}
      </section>

      <CsvImportDialog open={csvOpen} onClose={() => setCsvOpen(false)} />
      <CategoryCreateDialog open={categoryOpen} onClose={() => setCategoryOpen(false)} />
      {state.edit.kind !== 'closed' ? (
        <ParameterEditorDrawer
          key={editorKey}
          categories={categoriesQuery.data ?? []}
          fallbackFocusRef={listHeadingRef}
          target={state.edit}
          onClose={() => openEditor({ kind: 'closed' })}
        />
      ) : null}
    </section>
  )
}

interface ParameterRegistryTableProps {
  parameters: readonly ParameterOut[]
  categories: readonly CategoryOut[]
  onEdit: (parameterId: number) => void
}

export function ParameterRegistryTable({
  parameters,
  categories,
  onEdit,
}: ParameterRegistryTableProps) {
  const categoriesById = new Map(categories.map((category) => [category.id, category]))

  return (
    <div className="min-w-0 overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="w-full min-w-[880px] table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[20%]" />
          <col className="w-[9%]" />
          <col className="w-[14%]" />
          <col className="w-[20%]" />
          <col className="w-[9%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead className="bg-canvas text-xs font-semibold text-muted">
          <tr className="h-9">
            <th className="px-3" scope="col">Code</th>
            <th className="px-3" scope="col">표시명</th>
            <th className="px-3" scope="col">타입</th>
            <th className="px-3" scope="col">카테고리</th>
            <th className="px-3" scope="col">단위 / 제약</th>
            <th className="px-3" scope="col">상태</th>
            <th className="px-3 text-right" scope="col">작업</th>
          </tr>
        </thead>
        <tbody>
          {parameters.map((parameter) => {
            const category =
              parameter.category_id === null
                ? undefined
                : categoriesById.get(parameter.category_id)

            return (
              <tr
                key={parameter.id}
                className="h-9 shadow-[inset_0_1px_0_var(--color-border-subtle)]"
              >
                <td className="min-w-0 overflow-hidden px-3">
                  <span className="block truncate whitespace-nowrap font-mono text-xs font-semibold text-brand-700" title={parameter.code}>
                    {parameter.code}
                  </span>
                </td>
                <td className="min-w-0 overflow-hidden px-3">
                  <span className="block truncate whitespace-nowrap font-medium text-ink-950" title={parameter.display_name}>
                    {parameter.display_name}
                  </span>
                </td>
                <td className="px-3 text-xs text-muted">{parameter.value_type}</td>
                <td className="min-w-0 overflow-hidden px-3">
                  <span className="block truncate whitespace-nowrap text-muted" title={category?.display_name ?? '미분류'}>
                    {category?.display_name ?? '미분류'}
                  </span>
                </td>
                <td className="min-w-0 overflow-hidden px-3">
                  <span className="block truncate whitespace-nowrap text-muted" title={parameterConstraintSummary(parameter)}>
                    {parameterConstraintSummary(parameter)}
                  </span>
                </td>
                <td className="px-3">
                  {parameter.is_active ? (
                    <Badge tone="neutral">활성</Badge>
                  ) : (
                    <Badge tone="warning">비활성</Badge>
                  )}
                </td>
                <td className="px-3 text-right">
                  <Button
                    data-parameter-edit-trigger={parameter.id}
                    type="button"
                    variant="ghost"
                    onClick={() => onEdit(parameter.id)}
                  >
                    수정
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function parameterConstraintSummary(parameter: ParameterOut): string {
  if (parameter.value_type === 'choice') {
    const choiceSet = parameter.choice_set
      ? `${parameter.choice_set.code} · ${parameter.choice_set.display_name}`
      : '선택지 집합 없음'
    return parameter.required ? `필수 · ${choiceSet}` : choiceSet
  }
  if (parameter.value_type === 'text') {
    const guidance = [
      parameter.required ? '필수' : null,
      parameter.pattern_hint,
    ].filter((value): value is string => value !== null)
    return guidance.join(' · ') || '—'
  }

  const range =
    parameter.min_value !== null && parameter.max_value !== null
      ? `${parameter.min_value}–${parameter.max_value}`
      : parameter.min_value !== null
        ? `≥ ${parameter.min_value}`
        : parameter.max_value !== null
          ? `≤ ${parameter.max_value}`
          : ''
  const numeric = range && parameter.unit ? `${range} ${parameter.unit}` : range || parameter.unit
  if (parameter.required && numeric) return `필수 · ${numeric}`
  if (parameter.required) return '필수'
  return numeric || '—'
}

function editTargetKey(target: EditTarget): string {
  if (target.kind === 'existing') return `existing:${target.id}`
  if (target.kind === 'invalid') return `invalid:${target.raw}`
  return target.kind
}
