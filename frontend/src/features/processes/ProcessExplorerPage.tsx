import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { getApiErrorMessage } from '@/api/client'
import { getProcess, getProcessLayers, searchProcesses } from '@/api/processes'
import type { ProcessOut } from '@/api/types'
import { Badge } from '@/shared/components/Badge'
import { ErrorMessage, LoadingMessage } from '@/shared/components/StatusMessage'
import { PageHeader } from '@/shared/components/PageHeader'
import { cn } from '@/shared/lib/cn'

import { getProcessProjectHref } from './processProjectLink'
import { getSettledProcessSelection } from './processSelection'

export function ProcessExplorerPage() {
  const [query, setQuery] = useState('')
  const [withoutProject, setWithoutProject] = useState(false)

  const processesQuery = useQuery({
    queryKey: ['process-catalog', query, withoutProject],
    queryFn: () =>
      searchProcesses({ query: query.trim() || undefined, without_project: withoutProject }),
  })
  const processes = processesQuery.data?.items ?? []
  const [selectedProcessKey, setSelectedProcessKey] = useState<string | null>(
    () => processes[0]?.key ?? null,
  )
  const listSettledSuccessfully = processesQuery.isSuccess && !processesQuery.isFetching
  const activeProcessKey = listSettledSuccessfully
    ? getSettledProcessSelection(selectedProcessKey, processes)
    : selectedProcessKey

  useEffect(() => {
    if (!listSettledSuccessfully) return

    setSelectedProcessKey((currentKey) => getSettledProcessSelection(currentKey, processes))
  }, [listSettledSuccessfully, processes])

  const detailQuery = useQuery({
    queryKey: ['process', activeProcessKey],
    queryFn: () => getProcess(activeProcessKey as string),
    enabled: activeProcessKey !== null,
  })
  const layersQuery = useQuery({
    queryKey: ['process-layers', activeProcessKey],
    queryFn: () => getProcessLayers(activeProcessKey as string),
    enabled: activeProcessKey !== null,
  })

  return (
    <section className="space-y-5">
      <PageHeader
        eyebrow="Process Catalog"
        title="공정 카탈로그"
        description="적재 Process 구조를 검색하고 조건표 유무를 확인한 뒤 프로젝트 작업으로 이동합니다."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="grid w-full max-w-md gap-1.5 text-sm font-semibold text-ink-950">
          Process 검색
          <input
            className="input"
            placeholder="Line 또는 Process ID"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="flex h-9 items-center gap-2 text-sm font-medium text-ink-950">
          <input
            className="h-4 w-4 accent-brand-700"
            type="checkbox"
            checked={withoutProject}
            onChange={(event) => setWithoutProject(event.target.checked)}
          />
          조건표 없는 Process만
        </label>
      </div>

      {processesQuery.isPending ? (
        <LoadingMessage>Process 목록을 불러오는 중입니다.</LoadingMessage>
      ) : null}
      {processesQuery.isError ? (
        <ErrorMessage message={getApiErrorMessage(processesQuery.error)} />
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-xl border border-border-subtle bg-surface p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-semibold text-ink-950">Process 결과</h2>
            <span className="text-xs font-medium tabular-nums text-muted">{processes.length}개</span>
          </div>
          <div className="space-y-2">
            {processes.map((process) => (
              <ProcessResultButton
                key={process.key}
                process={process}
                selected={process.key === activeProcessKey}
                onSelect={() => setSelectedProcessKey(process.key)}
              />
            ))}
            {processes.length === 0 && !processesQuery.isPending && !processesQuery.isError ? (
              <p className="rounded-lg border border-dashed border-border-control px-3 py-5 text-center text-sm text-muted">
                조건에 맞는 Process가 없습니다.
              </p>
            ) : null}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <section className="rounded-xl border border-border-subtle bg-surface p-4">
            <h2 className="mb-3 font-semibold text-ink-950">구조 요약</h2>
            {detailQuery.isPending && activeProcessKey !== null ? (
              <LoadingMessage>Process 구조를 불러오는 중입니다.</LoadingMessage>
            ) : null}
            {detailQuery.isError ? (
              <ErrorMessage message={getApiErrorMessage(detailQuery.error)} />
            ) : null}
            {detailQuery.data ? (
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <dl className="grid min-w-0 flex-1 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs font-medium text-muted">Step</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums text-ink-950">
                      {detailQuery.data.step_count}개
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs font-medium text-muted">Area</dt>
                    <dd
                      className="mt-0.5 truncate font-semibold text-ink-950"
                      title={detailQuery.data.area_names.join(', ') || '-'}
                    >
                      {detailQuery.data.area_names.join(', ') || '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">프로젝트</dt>
                    <dd className="mt-0.5 font-semibold text-ink-950">
                      {detailQuery.data.has_project
                        ? `${detailQuery.data.project_count}개 있음`
                        : '없음'}
                    </dd>
                  </div>
                </dl>
                <Link
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-brand-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-ink-950"
                  to={getProcessProjectHref(detailQuery.data)}
                >
                  {detailQuery.data.has_project ? '기존 프로젝트 찾기' : '이 구조로 프로젝트 생성'}
                </Link>
              </div>
            ) : activeProcessKey === null ? (
              <p className="text-sm text-muted">왼쪽 목록에서 Process를 선택하세요.</p>
            ) : null}
          </section>

          <section className="rounded-xl border border-border-subtle bg-surface p-4">
            <h2 className="mb-3 font-semibold text-ink-950">Layer 구조</h2>
            <p className="mb-3 text-xs text-muted">조건 값 없이 Step과 Layer 구조만 표시합니다.</p>
            {layersQuery.isPending && activeProcessKey !== null ? (
              <LoadingMessage>Layer 구조를 불러오는 중입니다.</LoadingMessage>
            ) : null}
            {layersQuery.isError ? (
              <ErrorMessage message={getApiErrorMessage(layersQuery.error)} />
            ) : null}
            {layersQuery.data && layersQuery.data.length > 0 ? (
              <div className="min-w-0 overflow-x-auto rounded-lg border border-border-subtle">
                <table className="w-full min-w-[520px] table-fixed text-left text-sm">
                  <thead className="bg-canvas text-muted">
                    <tr className="h-9">
                      <th className="w-[42%] px-3 text-xs font-semibold" scope="col">
                        Layer (Step)
                      </th>
                      <th className="w-[29%] px-3 text-xs font-semibold" scope="col">
                        Area
                      </th>
                      <th className="w-[29%] px-3 text-xs font-semibold" scope="col">
                        설비 유형
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {layersQuery.data.map((layer) => {
                      const layerLabel = `${layer.layer_id} (${layer.step_seq})`
                      const equipmentLabel = layer.eqp_type ?? '-'

                      return (
                        <tr
                          key={layer.key}
                          className="h-9 shadow-[inset_0_1px_0_var(--color-border-subtle)]"
                        >
                          <td className="min-w-0 px-3 font-mono text-xs font-semibold text-brand-700">
                            <span className="block truncate" title={layerLabel}>
                              {layerLabel}
                            </span>
                          </td>
                          <td className="min-w-0 px-3 text-ink-950">
                            <span className="block truncate" title={layer.area_name ?? '-'}>
                              {layer.area_name ?? '-'}
                            </span>
                          </td>
                          <td className="min-w-0 px-3 text-muted">
                            <span className="block truncate" title={equipmentLabel}>
                              {equipmentLabel}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : layersQuery.data && !layersQuery.isPending ? (
              <p className="rounded-lg border border-dashed border-border-control px-3 py-5 text-center text-sm text-muted">
                표시할 Layer가 없습니다.
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </section>
  )
}

function ProcessResultButton({
  process,
  selected,
  onSelect,
}: {
  process: ProcessOut
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        'flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left transition-colors',
        selected
          ? 'border-brand-700 bg-brand-100 text-ink-950'
          : 'border-border-subtle bg-surface text-ink-950 hover:bg-canvas',
      )}
      type="button"
      onClick={onSelect}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-6 w-1 shrink-0 rounded-full',
          selected ? 'bg-brand-700' : 'bg-transparent',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="min-w-0 truncate font-mono text-xs font-semibold"
            title={process.display_name}
          >
            {process.line_id} / {process.process_id}
          </span>
          {selected ? (
            <span className="shrink-0 text-[11px] font-semibold text-brand-700">선택됨</span>
          ) : null}
        </span>
      </span>
      <Badge className="shrink-0" tone="neutral">
        {process.has_project ? '프로젝트 있음' : '프로젝트 없음'}
      </Badge>
    </button>
  )
}
