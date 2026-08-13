import { useQuery } from '@tanstack/react-query'

import { getProject } from '@/api/projects'
import type { ProjectLayerOut } from '@/api/types'

export function LayerBackboneContext({ layer }: { layer: ProjectLayerOut | null }) {
  const sourceProjectId = layer?.source_project_id ?? null
  const sourceLayerKey = layer?.source_layer_key ?? null
  const sourceProjectQuery = useQuery({
    queryKey: ['project', sourceProjectId],
    queryFn: () => getProject(sourceProjectId as number),
    enabled: sourceProjectId !== null,
  })
  const sourceLayer = sourceProjectQuery.data?.layers.find(
    (candidate) => candidate.layer_key === sourceLayerKey,
  )

  if (sourceProjectId === null || sourceLayerKey === null) {
    return <span className="text-xs text-muted">백본 없음</span>
  }
  if (sourceProjectQuery.isPending) {
    return <span className="text-xs text-muted">백본 정보 불러오는 중</span>
  }
  if (sourceProjectQuery.isError || sourceLayer === undefined) {
    return <span className="text-xs text-muted">백본 정보를 불러올 수 없음</span>
  }

  return (
    <span className="text-xs text-muted">
      {sourceProjectQuery.data.line_id} / {sourceProjectQuery.data.process_id} /{' '}
      {sourceProjectQuery.data.part_id} · {sourceLayer.step_seq} / {sourceLayer.layer_id}
    </span>
  )
}
