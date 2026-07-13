import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { getApiErrorMessage } from '@/api/client'
import { getProject, listProjects } from '@/api/projects'
import type { ProjectLayerOut, ProjectOut, ProjectSummaryOut } from '@/api/types'
import { ErrorMessage, LoadingMessage } from '@/shared/components/StatusMessage'

import { LayerReplaceModal } from './LayerReplaceModal'
import { ProjectCreateWizard } from './ProjectCreateWizard'

export function ProjectWorkspacePage() {
  const [search, setSearch] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)

  const projectsQuery = useQuery({
    queryKey: ['projects', search],
    queryFn: () => listProjects({ query: search.trim() || undefined }),
  })
  const projects = projectsQuery.data?.items ?? []
  const activeProjectId = selectedProjectId ?? projects[0]?.id ?? null
  const detailQuery = useQuery({
    queryKey: ['project', activeProjectId],
    queryFn: () => getProject(activeProjectId as number),
    enabled: activeProjectId !== null,
  })

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm text-cyan-700">Phase 1 · Project Backbone</p>
        <h2 className="text-2xl font-semibold">프로젝트 생성/조회</h2>
        <p className="mt-2 text-sm text-slate-500">
          process 구조를 선택하고 백본 프로젝트를 layer 매칭해 조건표(프로젝트)로 변신시킨다.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,440px)_1fr]">
        <ProjectCreateWizard onCreated={setSelectedProjectId} />

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">프로젝트 목록</h3>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
                {projects.length}개
              </span>
            </div>
            <input
              className="input mb-4"
              placeholder="이름/part id 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {projectsQuery.isLoading ? <LoadingMessage /> : null}
            {projectsQuery.isError ? <ErrorMessage message={getApiErrorMessage(projectsQuery.error)} /> : null}
            {projects.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    selected={project.id === activeProjectId}
                    onSelect={() => setSelectedProjectId(project.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                아직 생성된 프로젝트가 없다.
              </p>
            )}
          </div>

          {detailQuery.data ? <ProjectDetail project={detailQuery.data} /> : null}
        </div>
      </div>
    </section>
  )
}

function ProjectCard({
  project,
  selected,
  onSelect,
}: {
  project: ProjectSummaryOut
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'rounded-lg border p-3 text-left text-sm transition',
        selected ? 'border-cyan-500 bg-cyan-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50',
      ].join(' ')}
    >
      <span className="block font-semibold text-slate-900">{project.name}</span>
      <span className="mt-1 block font-mono text-xs text-slate-500">
        {project.line_id}/{project.process_id}/{project.part_id}
      </span>
      <span className="mt-2 inline-flex gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-cyan-50 px-2 py-0.5 font-medium text-cyan-700">{project.status}</span>
        <span>
          layer {project.layer_count} · 셀 {project.cell_count}
        </span>
      </span>
    </button>
  )
}

function ProjectDetail({ project }: { project: ProjectOut }) {
  const [replaceTarget, setReplaceTarget] = useState<ProjectLayerOut | null>(null)
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-cyan-700">Project #{project.id}</p>
          <h3 className="text-lg font-semibold">{project.name}</h3>
          <p className="mt-1 font-mono text-sm text-slate-500">
            {project.line_id}/{project.process_id}/{project.part_id}
          </p>
        </div>
        <Link className="btn-primary whitespace-nowrap" to={`/projects/${project.id}/sheet`}>
          조건표 시트 열기
        </Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">layer (step)</th>
              <th className="px-3 py-2">area</th>
              <th className="px-3 py-2">백본 소스</th>
              <th className="px-3 py-2">조건 행</th>
              <th className="px-3 py-2">셀</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {project.layers.map((layer) => (
              <tr key={layer.id} className="border-t border-slate-200">
                <td className="px-3 py-2 font-mono text-cyan-700">
                  {layer.layer_id} ({layer.step_seq})
                </td>
                <td className="px-3 py-2">{layer.area_name ?? '-'}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {layer.source_layer_key ? `#${layer.source_project_id}` : '빈 값'}
                </td>
                <td className="px-3 py-2">{layer.condition_count}</td>
                <td className="px-3 py-2">{layer.cell_count}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => setReplaceTarget(layer)}
                  >
                    교체
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
