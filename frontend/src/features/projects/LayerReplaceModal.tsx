import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { getApiErrorMessage } from '@/api/client'
import { acquireLock, releaseLock } from '@/api/locks'
import { getProject, listProjects, replaceLayerBackbone } from '@/api/projects'
import type { ProjectLayerOut, ProjectOut } from '@/api/types'
import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { Dialog } from '@/shared/components/ModalSurface'

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
    <Dialog
      open
      title="레이어 백본 교체"
      onRequestClose={(reason) => {
        if (reason !== 'escape' || !replaceMutation.isPending) onClose()
      }}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button
            type="button"
            disabled={!canApply}
            loading={replaceMutation.isPending}
            onClick={() => replaceMutation.mutate()}
          >
            교체 적용
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        {targetLayer.step_seq}/{targetLayer.layer_id} 를 다른 프로젝트 layer의 조건으로 교체한다.
      </p>

      <label className="block space-y-1 text-sm font-semibold text-ink-950">
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

      <label className="mt-3 block space-y-1 text-sm font-semibold text-ink-950">
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
        <InlineAlert className="mt-3" tone="error">
          {getApiErrorMessage(replaceMutation.error)}
        </InlineAlert>
      ) : null}
    </Dialog>
  )
}

function DiffCard({ title, layer }: { title: string; layer: ProjectLayerOut | null }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-canvas p-3">
      <p className="text-xs font-semibold text-muted">{title}</p>
      {layer ? (
        <p className="mt-1 text-ink-950">
          조건 {layer.condition_count}행 · 셀 {layer.cell_count}개
        </p>
      ) : (
        <p className="mt-1 text-muted">소스 layer 미선택</p>
      )}
    </div>
  )
}
