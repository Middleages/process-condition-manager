import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'

import { getApiErrorMessage } from '@/api/client'
import { listProcesses } from '@/api/processes'
import { createProject, listProjects } from '@/api/projects'
import type { ProcessOut, ProjectOut } from '@/api/types'
import { ErrorMessage, LoadingMessage } from '@/shared/components/StatusMessage'

export function ProjectWorkspacePage() {
  const queryClient = useQueryClient()
  const processesQuery = useQuery({ queryKey: ['processes'], queryFn: listProcesses })
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: listProjects })
  const processes = processesQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const [selectedProcessKey, setSelectedProcessKey] = useState<string>('')
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [partId, setPartId] = useState('')
  const [name, setName] = useState('')

  const selectedProcess = useMemo(
    () => processes.find((process) => process.key === selectedProcessKey) ?? null,
    [processes, selectedProcessKey],
  )
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  )

  useEffect(() => {
    if (selectedProcessKey === '' && processes[0] !== undefined) {
      setSelectedProcessKey(processes[0].key)
    }
  }, [processes, selectedProcessKey])

  useEffect(() => {
    if (selectedProjectId === null && projects[0] !== undefined) {
      setSelectedProjectId(projects[0].id)
    }
  }, [projects, selectedProjectId])

  const createMutation = useMutation({
    mutationFn: async () => {
      if (selectedProcess === null) {
        throw new Error('process를 선택해 주세요')
      }
      return createProject({
        line_id: selectedProcess.line_id,
        process_id: selectedProcess.process_id,
        part_id: partId.trim(),
        name: name.trim(),
      })
    },
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      setSelectedProjectId(project.id)
      setPartId('')
      setName('')
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createMutation.mutate()
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm text-cyan-700">Phase 1 · Project Backbone</p>
        <h2 className="text-2xl font-semibold">프로젝트 생성/조회</h2>
        <p className="mt-2 text-sm text-slate-500">
          적재 process 구조를 선택하고 part id를 입력해 draft 프로젝트를 생성한다.
          백본 없이 시작하면 각 layer는 기본 조건 행 1개로 만들어진다.
        </p>
      </div>

      {processesQuery.isLoading || projectsQuery.isLoading ? <LoadingMessage /> : null}
      {processesQuery.isError ? <ErrorMessage message={getApiErrorMessage(processesQuery.error)} /> : null}
      {projectsQuery.isError ? <ErrorMessage message={getApiErrorMessage(projectsQuery.error)} /> : null}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h3 className="text-lg font-semibold">새 프로젝트</h3>
            <p className="mt-1 text-sm text-slate-500">Phase 1 첫 단계는 백본 없이 빈 조건표를 만든다.</p>
          </div>
          <Field label="Process">
            <select
              className="input"
              value={selectedProcessKey}
              onChange={(event) => setSelectedProcessKey(event.target.value)}
              required
            >
              {processes.map((process) => (
                <option key={process.key} value={process.key}>
                  {process.display_name}
                </option>
              ))}
            </select>
          </Field>
          <ProcessSummary process={selectedProcess} />
          <Field label="Part ID">
            <input className="input" value={partId} onChange={(event) => setPartId(event.target.value)} required />
          </Field>
          <Field label="프로젝트명">
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} required />
          </Field>
          <button className="btn-primary" type="submit" disabled={createMutation.isPending || selectedProcess === null}>
            {createMutation.isPending ? '생성 중...' : '프로젝트 생성'}
          </button>
          {createMutation.isError ? <ErrorMessage message={getApiErrorMessage(createMutation.error)} /> : null}
        </form>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">프로젝트 목록</h3>
                <p className="mt-1 text-sm text-slate-500">생성된 draft 프로젝트를 선택해 구조를 확인한다.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">{projects.length}개</span>
            </div>
            {projects.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    selected={project.id === selectedProject?.id}
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

          {selectedProject ? <ProjectDetail project={selectedProject} /> : null}
        </div>
      </div>
    </section>
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

function ProcessSummary({ process }: { process: ProcessOut | null }) {
  if (process === null) {
    return <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">process 없음</p>
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="font-mono text-cyan-700">{process.key}</p>
      <p className="mt-1 text-slate-600">
        line {process.line_id} · process {process.process_id}
      </p>
    </div>
  )
}

function ProjectCard({ project, selected, onSelect }: { project: ProjectOut; selected: boolean; onSelect: () => void }) {
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
      <span className="mt-2 inline-flex rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700">
        {project.status}
      </span>
    </button>
  )
}

function ProjectDetail({ project }: { project: ProjectOut }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <p className="text-sm text-cyan-700">Project #{project.id}</p>
        <h3 className="text-lg font-semibold">{project.name}</h3>
        <p className="mt-1 font-mono text-sm text-slate-500">
          {project.line_id}/{project.process_id}/{project.part_id}
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">step</th>
              <th className="px-3 py-2">layer</th>
              <th className="px-3 py-2">area</th>
              <th className="px-3 py-2">조건 행</th>
              <th className="px-3 py-2">셀</th>
            </tr>
          </thead>
          <tbody>
            {project.layers.map((layer) => (
              <tr key={layer.id} className="border-t border-slate-200">
                <td className="px-3 py-2 font-mono text-cyan-700">{layer.step_seq}</td>
                <td className="px-3 py-2 font-mono">{layer.layer_id}</td>
                <td className="px-3 py-2">{layer.area_name ?? '-'}</td>
                <td className="px-3 py-2">{layer.condition_count}</td>
                <td className="px-3 py-2">{layer.cell_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
