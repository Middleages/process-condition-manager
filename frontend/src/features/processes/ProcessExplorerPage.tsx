import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { getApiErrorMessage } from '@/api/client'
import { getProcess, getProcessLayers, searchProcesses } from '@/api/processes'
import { ErrorMessage, LoadingMessage } from '@/shared/components/StatusMessage'

export function ProcessExplorerPage() {
  const [query, setQuery] = useState('')
  const [withoutProject, setWithoutProject] = useState(false)
  const [selectedProcessKey, setSelectedProcessKey] = useState<string | null>(null)

  const processesQuery = useQuery({
    queryKey: ['process-catalog', query, withoutProject],
    queryFn: () =>
      searchProcesses({ query: query.trim() || undefined, without_project: withoutProject }),
  })
  const processes = processesQuery.data?.items ?? []

  useEffect(() => {
    if (processes[0] && !processes.some((p) => p.key === selectedProcessKey)) {
      setSelectedProcessKey(processes[0].key)
    }
  }, [processes, selectedProcessKey])

  const detailQuery = useQuery({
    queryKey: ['process', selectedProcessKey],
    queryFn: () => getProcess(selectedProcessKey as string),
    enabled: selectedProcessKey !== null,
  })
  const layersQuery = useQuery({
    queryKey: ['process-layers', selectedProcessKey],
    queryFn: () => getProcessLayers(selectedProcessKey as string),
    enabled: selectedProcessKey !== null,
  })

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm text-cyan-700">Phase 1 · Process Catalog</p>
        <h2 className="text-2xl font-semibold">공정 카탈로그</h2>
        <p className="mt-2 text-sm text-slate-500">
          적재 process 구조를 검색하고, 조건표 유무를 확인한 뒤 프로젝트 생성으로 넘어간다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input max-w-xs"
          placeholder="line/process 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={withoutProject}
            onChange={(event) => setWithoutProject(event.target.checked)}
          />
          조건표 없는 process만
        </label>
      </div>

      {processesQuery.isLoading ? <LoadingMessage /> : null}
      {processesQuery.isError ? <ErrorMessage message={getApiErrorMessage(processesQuery.error)} /> : null}

      <div className="grid gap-6 md:grid-cols-[320px_1fr]">
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold">Process 결과</h3>
          <div className="space-y-2">
            {processes.map((process) => (
              <button
                key={process.key}
                type="button"
                className={[
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition',
                  process.key === selectedProcessKey
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
                ].join(' ')}
                onClick={() => setSelectedProcessKey(process.key)}
              >
                <span className="font-mono text-xs">
                  {process.line_id} / {process.process_id}
                </span>
                <span
                  className={[
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    process.key === selectedProcessKey
                      ? 'bg-white/20 text-white'
                      : process.has_project
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-500',
                  ].join(' ')}
                >
                  {process.has_project ? '조건표 있음' : '없음'}
                </span>
              </button>
            ))}
            {processes.length === 0 && !processesQuery.isLoading ? (
              <p className="text-sm text-slate-500">조건에 맞는 process가 없다.</p>
            ) : null}
          </div>
        </aside>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 font-semibold">구조 요약</h3>
            {detailQuery.data ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
                <span>
                  step 수 <strong className="text-slate-900">{detailQuery.data.step_count}</strong>
                </span>
                <span>area {detailQuery.data.area_names.join(', ') || '-'}</span>
                <span>
                  조건표{' '}
                  {detailQuery.data.has_project
                    ? `있음 (${detailQuery.data.project_count}개)`
                    : '없음'}
                </span>
                <Link className="btn-primary ml-auto" to="/projects">
                  {detailQuery.data.has_project ? '기존 프로젝트 열기' : '이 구조로 프로젝트 생성'}
                </Link>
              </div>
            ) : (
              <p className="text-sm text-slate-500">process를 선택한다.</p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 font-semibold">Layer 구조 (값 없음 — 구조만)</h3>
            {layersQuery.isLoading ? <LoadingMessage /> : null}
            {layersQuery.data ? (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">layer (step)</th>
                      <th className="px-3 py-2">area</th>
                      <th className="px-3 py-2">eqp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {layersQuery.data.map((layer) => (
                      <tr key={layer.key} className="border-t border-slate-200">
                        <td className="px-3 py-2 font-mono text-cyan-700">
                          {layer.layer_id} ({layer.step_seq})
                        </td>
                        <td className="px-3 py-2">{layer.area_name ?? '-'}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{layer.eqp_type ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
