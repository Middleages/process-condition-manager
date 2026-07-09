import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { getProcessLayers, listProcesses } from '@/api/processes'
import { getApiErrorMessage } from '@/api/client'
import { ErrorMessage, LoadingMessage } from '@/shared/components/StatusMessage'

export function ProcessExplorerPage() {
  const processesQuery = useQuery({ queryKey: ['processes'], queryFn: listProcesses })
  const [selectedProcessKey, setSelectedProcessKey] = useState<string | null>(null)

  const layersQuery = useQuery({
    queryKey: ['process-layers', selectedProcessKey],
    queryFn: () => getProcessLayers(selectedProcessKey ?? ''),
    enabled: selectedProcessKey !== null,
  })

  const processes = processesQuery.data ?? []

  useEffect(() => {
    if (selectedProcessKey === null && processes[0] !== undefined) {
      setSelectedProcessKey(processes[0].key)
    }
  }, [processes, selectedProcessKey])

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm text-cyan-700">Phase 0 · EC2 확인</p>
        <h2 className="text-2xl font-semibold">공정/layer 확인</h2>
        <p className="mt-2 text-sm text-slate-500">
          fixture 적재 판독기를 통해 process 목록과 동적 layer 구성을 확인한다.
        </p>
      </div>

      {processesQuery.isLoading ? <LoadingMessage /> : null}
      {processesQuery.isError ? <ErrorMessage message={getApiErrorMessage(processesQuery.error)} /> : null}

      {processes.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-[280px_1fr]">
          <aside className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
            <h3 className="mb-3 font-semibold">Process</h3>
            <div className="space-y-2">
              {processes.map((process) => (
                <button
                  key={process.key}
                  type="button"
                  className={[
                    'w-full rounded-lg px-3 py-2 text-left text-sm transition',
                    process.key === selectedProcessKey
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
                  ].join(' ')}
                  onClick={() => setSelectedProcessKey(process.key)}
                >
                  <span className="block font-medium">{process.display_name}</span>
                  <span className="font-mono text-xs opacity-80">
                    {process.line_id} / {process.process_id}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
            <h3 className="mb-3 font-semibold">Layer 구성</h3>
            {layersQuery.isLoading ? <LoadingMessage /> : null}
            {layersQuery.isError ? <ErrorMessage message={getApiErrorMessage(layersQuery.error)} /> : null}
            {layersQuery.data ? (
              <ol className="space-y-3">
                {layersQuery.data.map((layer) => (
                  <li key={layer.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Step {layer.step_seq}</span>
                      <span className="text-xs text-slate-500">layer {layer.layer_id}</span>
                    </div>
                    <p className="mt-1 font-mono text-sm text-cyan-700">{layer.key}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {layer.area_name ?? '-'} · {layer.eqp_type ?? '-'}
                    </p>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
