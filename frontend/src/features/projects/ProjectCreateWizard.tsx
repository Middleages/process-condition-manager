import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'

import { getApiErrorMessage } from '@/api/client'
import { getProcess, listProcesses } from '@/api/processes'
import {
  createProject,
  getBackboneCandidates,
  getProject,
  previewBackbone,
} from '@/api/projects'
import type { ManualOverrideIn, MatchType } from '@/api/types'
import { ErrorMessage } from '@/shared/components/StatusMessage'

export function ProjectCreateWizard({ onCreated }: { onCreated: (projectId: number) => void }) {
  const queryClient = useQueryClient()
  const processesQuery = useQuery({ queryKey: ['processes'], queryFn: listProcesses })
  const processes = processesQuery.data ?? []

  const [processKey, setProcessKey] = useState('')
  const [backboneId, setBackboneId] = useState<number | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [partId, setPartId] = useState('')
  const [name, setName] = useState('')

  const selectedProcess = useMemo(
    () => processes.find((p) => p.key === processKey) ?? null,
    [processes, processKey],
  )

  useEffect(() => {
    if (processKey === '' && processes[0]) setProcessKey(processes[0].key)
  }, [processes, processKey])

  // process가 바뀌면 백본/매칭 선택을 초기화한다.
  useEffect(() => {
    setBackboneId(null)
    setOverrides({})
  }, [processKey])

  const detailQuery = useQuery({
    queryKey: ['process', processKey],
    queryFn: () => getProcess(processKey),
    enabled: processKey !== '',
  })
  const candidatesQuery = useQuery({
    queryKey: ['backbone-candidates', selectedProcess?.line_id, selectedProcess?.process_id],
    queryFn: () => getBackboneCandidates(selectedProcess!.line_id, selectedProcess!.process_id),
    enabled: selectedProcess !== null,
  })
  const backboneDetailQuery = useQuery({
    queryKey: ['project', backboneId],
    queryFn: () => getProject(backboneId as number),
    enabled: backboneId !== null,
  })

  const overrideList: ManualOverrideIn[] = useMemo(
    () =>
      Object.entries(overrides).map(([target_layer_key, source_layer_key]) => ({
        target_layer_key,
        source_layer_key,
      })),
    [overrides],
  )

  const previewQuery = useQuery({
    queryKey: ['backbone-preview', processKey, backboneId, overrideList],
    queryFn: () =>
      previewBackbone({
        line_id: selectedProcess!.line_id,
        process_id: selectedProcess!.process_id,
        backbone_project_id: backboneId,
        manual_overrides: overrideList,
      }),
    enabled: selectedProcess !== null,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      createProject({
        line_id: selectedProcess!.line_id,
        process_id: selectedProcess!.process_id,
        part_id: partId.trim(),
        name: name.trim(),
        backbone_project_id: backboneId,
        manual_overrides: overrideList,
      }),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      setPartId('')
      setName('')
      onCreated(project.id)
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createMutation.mutate()
  }

  const duplicateBlocked = detailQuery.data?.has_project ?? false
  const preview = previewQuery.data
  const backboneLayers = backboneDetailQuery.data?.layers ?? []

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-lg font-semibold">새 프로젝트 생성</h3>
        <p className="mt-1 text-sm text-slate-500">① Process 확인 → ② 백본 선택 → ③ 매칭 확인</p>
      </div>

      {/* ① Process */}
      <Step index="①" title="Process(구조) 확인">
        <select className="input" value={processKey} onChange={(e) => setProcessKey(e.target.value)} required>
          {processes.map((process) => (
            <option key={process.key} value={process.key}>
              {process.display_name}
              {process.has_project ? ' — 조건표 있음' : ''}
            </option>
          ))}
        </select>
        {detailQuery.data ? (
          <p className="mt-2 text-sm text-slate-600">
            Steps {detailQuery.data.step_count} · area {detailQuery.data.area_names.join(', ') || '-'} ·{' '}
            조건표 {duplicateBlocked ? `있음 (${detailQuery.data.project_count}개)` : '없음 → 신규'}
          </p>
        ) : null}
        {duplicateBlocked ? (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            이 process에는 이미 조건표가 있어 신규 생성이 차단된다 (P1-D6). 기존 프로젝트를 열어 편집한다.
          </p>
        ) : null}
      </Step>

      {/* ② 백본 선택 */}
      <Step index="②" title="백본 프로젝트(값) 선택">
        <div className="space-y-2">
          <BackboneOption
            selected={backboneId === null}
            onSelect={() => setBackboneId(null)}
            title="백본 없이 시작"
            subtitle="모든 셀 빈 값 (부트스트랩)"
          />
          {(candidatesQuery.data ?? []).map((candidate) => (
            <BackboneOption
              key={candidate.id}
              selected={backboneId === candidate.id}
              onSelect={() => {
                setBackboneId(candidate.id)
                setOverrides({})
              }}
              title={`${candidate.name} · ${candidate.part_id}`}
              subtitle={`layer 매칭 ${candidate.matched_count}/${candidate.layer_count} (${Math.round(
                candidate.match_rate * 100,
              )}%)`}
            />
          ))}
          {candidatesQuery.data?.length === 0 ? (
            <p className="text-sm text-slate-500">후보 프로젝트가 없다 — 백본 없이 시작한다.</p>
          ) : null}
        </div>
      </Step>

      {/* ③ 매칭 확인 */}
      <Step index="③" title="매칭 확인 (dry-run) — 자동 키: step_seq + layer_id">
        {previewQuery.isError ? <ErrorMessage message={getApiErrorMessage(previewQuery.error)} /> : null}
        {preview ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              자동/수동 매칭 {preview.matched_count} · 미매칭 {preview.unmatched_count} · 복사 예정 셀{' '}
              {preview.copy_cell_count}
            </p>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2">target layer</th>
                    <th className="px-3 py-2">매칭</th>
                    <th className="px-3 py-2">백본 source / 수동 매칭</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.matches.map((match) => (
                    <tr key={match.target_layer_key} className="border-t border-slate-200">
                      <td className="px-3 py-2 font-mono text-xs">{match.target_layer_key}</td>
                      <td className="px-3 py-2">
                        <MatchBadge type={match.match_type} />
                      </td>
                      <td className="px-3 py-2">
                        {backboneId !== null && match.match_type !== 'auto' ? (
                          <select
                            className="input"
                            value={overrides[match.target_layer_key] ?? ''}
                            onChange={(e) => {
                              const value = e.target.value
                              setOverrides((current) => {
                                const next = { ...current }
                                if (value === '') delete next[match.target_layer_key]
                                else next[match.target_layer_key] = value
                                return next
                              })
                            }}
                          >
                            <option value="">(미매칭 · 빈 값)</option>
                            {backboneLayers.map((layer) => (
                              <option key={layer.layer_key} value={layer.layer_key}>
                                {layer.step_seq}/{layer.layer_id}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-mono text-xs text-slate-500">
                            {match.source_layer_key ?? '-'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Step>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Part ID">
          <input className="input" value={partId} onChange={(e) => setPartId(e.target.value)} required />
        </Field>
        <Field label="프로젝트명">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          type="submit"
          disabled={createMutation.isPending || selectedProcess === null || duplicateBlocked}
        >
          {createMutation.isPending ? '생성 중...' : '프로젝트 생성'}
        </button>
        {createMutation.isError ? (
          <span className="text-sm text-red-600">{getApiErrorMessage(createMutation.error)}</span>
        ) : null}
      </div>
    </form>
  )
}

function Step({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-700">
        <span className="text-cyan-700">{index}</span> {title}
      </p>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm text-slate-600">
      <span>{label}</span>
      {children}
    </label>
  )
}

function BackboneOption({
  selected,
  onSelect,
  title,
  subtitle,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  subtitle: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition',
        selected ? 'border-cyan-500 bg-cyan-50' : 'border-slate-200 bg-white hover:bg-slate-50',
      ].join(' ')}
    >
      <span className="font-medium text-slate-800">{title}</span>
      <span className="text-xs text-slate-500">{subtitle}</span>
    </button>
  )
}

const MATCH_TONE: Record<MatchType, string> = {
  auto: 'bg-emerald-50 text-emerald-700',
  manual: 'bg-cyan-50 text-cyan-700',
  unmatched: 'bg-slate-100 text-slate-500',
}

function MatchBadge({ type }: { type: MatchType }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MATCH_TONE[type]}`}>{type}</span>
}
