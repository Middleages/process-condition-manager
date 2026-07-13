import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { getApiErrorMessage } from '@/api/client'
import { acquireLock, releaseLock } from '@/api/locks'
import { getProject, listProjects, replaceLayerBackbone } from '@/api/projects'
import type { ProjectLayerOut, ProjectOut } from '@/api/types'

export function LayerReplaceModal({
  project,
  targetLayer,
  onClose,
}: {
  project: ProjectOut
  targetLayer: ProjectLayerOut
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [sourceProjectId, setSourceProjectId] = useState<number | null>(null)
  const [sourceLayerKey, setSourceLayerKey] = useState('')

  const projectsQuery = useQuery({
    queryKey: ['projects', ''],
    queryFn: () => listProjects(),
  })
  const sourceDetailQuery = useQuery({
    queryKey: ['project', sourceProjectId],
    queryFn: () => getProject(sourceProjectId as number),
    enabled: sourceProjectId !== null,
  })

  const sourceLayers = sourceDetailQuery.data?.layers ?? []
  const sourceLayer = useMemo(
    () => sourceLayers.find((layer) => layer.layer_key === sourceLayerKey) ?? null,
    [sourceLayers, sourceLayerKey],
  )

  const replaceMutation = useMutation({
    // 이 교체 작업 하나만을 위해 잠금을 짧게 획득→해제한다(P2-D6). 다른 세션이
    // 편집 중이면 acquireLock이 409로 실패하고 그대로 에러가 표시된다. 지속 보유 +
    // 하트비트가 필요한 시트 편집 화면(T3/T4)과는 별개의 용도다.
    mutationFn: async () => {
      const lock = await acquireLock(project.id)
      try {
        return await replaceLayerBackbone(
          project.id,
          targetLayer.layer_key,
          { source_project_id: sourceProjectId as number, source_layer_key: sourceLayerKey },
          lock.lock_token,
        )
      } finally {
        await releaseLock(project.id, lock.lock_token).catch(() => {
          // 해제 실패는 무해하다 — TTL 만료가 최종 보험(P2-D4).
        })
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      onClose()
    },
  })

  const candidates = (projectsQuery.data?.items ?? []).filter((p) => p.id !== project.id)
  const canApply = sourceProjectId !== null && sourceLayerKey !== ''

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-lg font-semibold">레이어 백본 교체</h3>
          <p className="mt-1 text-sm text-slate-500">
            {targetLayer.step_seq}/{targetLayer.layer_id} 를 다른 프로젝트 layer의 조건으로 교체한다.
          </p>
        </div>

        <label className="block space-y-1 text-sm text-slate-600">
          <span>소스 프로젝트</span>
          <select
            className="input"
            value={sourceProjectId ?? ''}
            onChange={(event) => {
              setSourceProjectId(event.target.value ? Number(event.target.value) : null)
              setSourceLayerKey('')
            }}
          >
            <option value="">선택</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} · {candidate.part_id}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block space-y-1 text-sm text-slate-600">
          <span>소스 layer</span>
          <select
            className="input"
            value={sourceLayerKey}
            onChange={(event) => setSourceLayerKey(event.target.value)}
            disabled={sourceProjectId === null}
          >
            <option value="">선택</option>
            {sourceLayers.map((layer) => (
              <option key={layer.layer_key} value={layer.layer_key}>
                {layer.step_seq}/{layer.layer_id} (조건 {layer.condition_count} · 셀 {layer.cell_count})
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <DiffCard title="현재 (교체 전)" layer={targetLayer} />
          <DiffCard title="교체 후 (소스)" layer={sourceLayer} />
        </div>

        {replaceMutation.isError ? (
          <p className="mt-3 text-sm text-red-600">{getApiErrorMessage(replaceMutation.error)}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" type="button" onClick={onClose}>
            취소
          </button>
          <button
            className="btn-primary"
            type="button"
            disabled={!canApply || replaceMutation.isPending}
            onClick={() => replaceMutation.mutate()}
          >
            {replaceMutation.isPending ? '교체 중...' : '교체 적용'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DiffCard({ title, layer }: { title: string; layer: ProjectLayerOut | null }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-500">{title}</p>
      {layer ? (
        <p className="mt-1 text-slate-700">
          조건 {layer.condition_count}행 · 셀 {layer.cell_count}개
        </p>
      ) : (
        <p className="mt-1 text-slate-400">소스 layer 미선택</p>
      )}
    </div>
  )
}
