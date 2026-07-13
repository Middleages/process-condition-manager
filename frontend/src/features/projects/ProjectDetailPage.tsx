import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { getApiErrorMessage } from '@/api/client'
import { getProject } from '@/api/projects'
import type { ProjectLayerOut, ProjectOut } from '@/api/types'
import { Badge } from '@/shared/components/Badge'
import { Button } from '@/shared/components/Button'
import { InlineAlert } from '@/shared/components/InlineAlert'
import { PageHeader } from '@/shared/components/PageHeader'
import { parsePositiveInt } from '@/shared/navigation/routeState'

import { LayerReplaceModal } from './LayerReplaceModal'

export function ProjectDetailPage() {
  const { projectId: rawProjectId } = useParams()
  const projectId = parsePositiveInt(rawProjectId)
  const location = useLocation()
  const from = getProjectListReturnPath(location.state)

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId as number),
    enabled: projectId !== null,
  })

  return (
    <section className="space-y-5">
      <PageHeader
        data-page-title
        tabIndex={-1}
        eyebrow={
          projectQuery.data ? (
            <span className="inline-flex items-center gap-2">
              Project #{projectQuery.data.id}
              <Badge tone="draft">초안</Badge>
            </span>
          ) : (
            '프로젝트'
          )
        }
        title={projectQuery.data?.name ?? '프로젝트 상세'}
        description={
          projectQuery.data
            ? `${projectQuery.data.line_id} / ${projectQuery.data.process_id} / ${projectQuery.data.part_id}`
            : '프로젝트 정보와 Layer 구성을 확인합니다.'
        }
        actions={
          <>
            <Link
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border-control bg-surface px-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-canvas"
              to={from}
            >
              <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
              목록으로
            </Link>
            {projectQuery.data ? (
              <Link
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-brand-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-ink-950"
                to={`/projects/${projectQuery.data.id}/sheet`}
              >
                조건표 열기
                <ExternalLink aria-hidden="true" size={16} strokeWidth={2} />
              </Link>
            ) : null}
          </>
        }
      />

      <div>
        {projectId === null ? (
          <InlineAlert tone="error">올바른 프로젝트 ID가 아닙니다. 목록에서 다시 선택하세요.</InlineAlert>
        ) : projectQuery.isPending ? (
          <InlineAlert tone="info">프로젝트 상세를 불러오는 중입니다.</InlineAlert>
        ) : projectQuery.isError ? (
          <InlineAlert className="flex flex-wrap items-center justify-between gap-3" tone="error">
            <span>{getApiErrorMessage(projectQuery.error)}</span>
            <Button size="compact" variant="secondary" onClick={() => projectQuery.refetch()}>
              다시 시도
            </Button>
          </InlineAlert>
        ) : projectQuery.data ? (
          <ProjectDetail project={projectQuery.data} />
        ) : null}
      </div>
    </section>
  )
}

function ProjectDetail({ project }: { project: ProjectOut }) {
  const [replaceTarget, setReplaceTarget] = useState<ProjectLayerOut | null>(null)
  const summary = {
    layerCount: project.layers.length,
    conditionCount: project.layers.reduce((sum, layer) => sum + layer.condition_count, 0),
    cellCount: project.layers.reduce((sum, layer) => sum + layer.cell_count, 0),
  }

  return (
    <div className="space-y-5">
      <dl className="grid overflow-hidden rounded-xl border border-border-subtle bg-surface sm:grid-cols-3">
        <SummaryItem label="Layer" value={summary.layerCount} />
        <SummaryItem label="조건 행" value={summary.conditionCount} />
        <SummaryItem label="Cell" value={summary.cellCount} />
      </dl>

      <section aria-labelledby="project-layers-title" className="space-y-3">
        <div>
          <h2 id="project-layers-title" className="text-lg font-bold text-ink-950">
            Layer 구성
          </h2>
          <p className="mt-0.5 text-sm text-muted">Layer별 백본 소스와 조건 데이터를 확인합니다.</p>
        </div>

        <div className="max-w-full overflow-x-auto rounded-xl border border-border-subtle bg-surface">
          <table className="w-full min-w-[820px] table-fixed text-left text-sm">
            <thead className="bg-canvas text-xs font-semibold uppercase tracking-wide text-muted">
              <tr className="h-9">
                <th className="w-[22%] whitespace-nowrap px-4 py-0" scope="col">
                  Layer (Step)
                </th>
                <th className="w-[18%] whitespace-nowrap px-4 py-0" scope="col">
                  Area
                </th>
                <th className="w-[28%] whitespace-nowrap px-4 py-0" scope="col">
                  백본 소스
                </th>
                <th className="w-[12%] whitespace-nowrap px-4 py-0 text-right" scope="col">
                  조건 행
                </th>
                <th className="w-[10%] whitespace-nowrap px-4 py-0 text-right" scope="col">
                  Cell
                </th>
                <th className="w-[10%] whitespace-nowrap px-4 py-0 text-right" scope="col">
                  <span className="sr-only">작업</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {project.layers.map((layer) => {
                const layerLabel = `${layer.layer_id} (${layer.step_seq})`
                const areaLabel = layer.area_name ?? '-'
                const sourceLabel = layer.source_layer_key
                  ? `#${layer.source_project_id} · ${layer.source_layer_key}`
                  : '빈 값'

                return (
                  <tr
                    key={layer.id}
                    className="h-9 shadow-[inset_0_1px_0_var(--color-border-subtle)]"
                  >
                    <td className="min-w-0 overflow-hidden px-4 py-0 font-mono text-xs font-semibold text-brand-700">
                      <span
                        className="block min-w-0 truncate whitespace-nowrap"
                        title={layerLabel}
                      >
                        {layerLabel}
                      </span>
                    </td>
                    <td className="min-w-0 overflow-hidden px-4 py-0 text-ink-950">
                      <span
                        className="block min-w-0 truncate whitespace-nowrap"
                        title={areaLabel}
                      >
                        {areaLabel}
                      </span>
                    </td>
                    <td className="min-w-0 overflow-hidden px-4 py-0 font-mono text-xs text-muted">
                      <span
                        className="block min-w-0 truncate whitespace-nowrap"
                        title={sourceLabel}
                      >
                        {sourceLabel}
                      </span>
                    </td>
                    <td className="min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 text-right font-mono text-xs tabular-nums">
                      {layer.condition_count}
                    </td>
                    <td className="min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 text-right font-mono text-xs tabular-nums">
                      {layer.cell_count}
                    </td>
                    <td className="min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 text-right">
                      <Button
                        className="h-9"
                        size="compact"
                        variant="secondary"
                        onClick={() => setReplaceTarget(layer)}
                      >
                        교체
                      </Button>
                    </td>
                  </tr>
                )
              })}
              {project.layers.length === 0 ? (
                <tr className="border-t border-border-subtle">
                  <td className="px-4 py-8 text-center text-sm text-muted" colSpan={6}>
                    표시할 Layer가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {replaceTarget ? (
        <LayerReplaceModal
          project={project}
          targetLayer={replaceTarget}
          onClose={() => setReplaceTarget(null)}
        />
      ) : null}
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-b border-border-subtle px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-bold tabular-nums text-ink-950">{value}</dd>
    </div>
  )
}

function getProjectListReturnPath(state: unknown): string {
  if (
    typeof state === 'object' &&
    state !== null &&
    'from' in state &&
    typeof state.from === 'string' &&
    (state.from === '/projects' || state.from.startsWith('/projects?'))
  ) {
    return state.from
  }

  return '/projects'
}
