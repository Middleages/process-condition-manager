import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { ProjectSummaryOut } from '@/api/types'
import { Badge } from '@/shared/components/Badge'

export interface ProjectTableProps {
  projects: ProjectSummaryOut[]
  from: string
  onProjectOpen: (projectId: number) => void
}

export function ProjectTable({ projects, from, onProjectOpen }: ProjectTableProps) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<number[]>([])

  return (
    <div className="max-w-full overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="w-full min-w-[760px] table-fixed text-left text-sm">
        <thead className="bg-canvas text-xs font-semibold uppercase tracking-wide text-muted">
          <tr className="h-9">
            <th className="w-[18%] whitespace-nowrap px-4 py-0" scope="col">
              LINE
            </th>
            <th className="w-[20%] whitespace-nowrap px-4 py-0" scope="col">
              PROCESS
            </th>
            <th className="w-[20%] whitespace-nowrap px-4 py-0" scope="col">
              PART ID
            </th>
            <th className="w-[14%] whitespace-nowrap px-4 py-0" scope="col">
              상태
            </th>
            <th className="w-[20%] whitespace-nowrap px-4 py-0" scope="col">
              UPDATED
            </th>
            <th aria-label="세부 정보" className="w-12 px-2 py-0" scope="col" />
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const isExpanded = expandedProjectIds.includes(project.id)
            const detailId = `project-details-${project.id}`

            return (
              <ProjectTableRow
                detailId={detailId}
                from={from}
                isExpanded={isExpanded}
                key={project.id}
                onProjectOpen={onProjectOpen}
                project={project}
                onToggle={() =>
                  setExpandedProjectIds((currentProjectIds) =>
                    toggleExpandedProject(currentProjectIds, project.id),
                  )
                }
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ProjectTableRow({
  detailId,
  from,
  isExpanded,
  onProjectOpen,
  onToggle,
  project,
}: {
  detailId: string
  from: string
  isExpanded: boolean
  onProjectOpen: (projectId: number) => void
  onToggle: () => void
  project: ProjectSummaryOut
}) {
  return (
    <>
      <tr className="h-10 border-t border-border-subtle hover:bg-canvas/70">
        <td className="min-w-0 overflow-hidden px-4 py-0.5 align-middle">
          <Link
            className="block min-w-0 max-w-full truncate whitespace-nowrap rounded-sm font-mono text-xs font-semibold leading-4 text-ink-950 underline decoration-transparent underline-offset-4 transition-colors hover:text-brand-700 hover:decoration-current"
            data-project-id={project.id}
            state={{ from }}
            title={project.line_id}
            to={`/projects/${project.id}`}
            onClick={() => onProjectOpen(project.id)}
          >
            {project.line_id}
          </Link>
        </td>
        <IdentityCell value={project.process_id} />
        <IdentityCell value={project.part_id} />
        <td className="min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 align-middle">
          <Badge tone={statusBadgeTone(project.status)}>{statusLabel(project.status)}</Badge>
        </td>
        <td className="min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 text-xs tabular-nums text-muted">
          <time dateTime={project.updated_at}>{formatUpdatedAt(project.updated_at)}</time>
        </td>
        <td className="px-2 py-0 text-right align-middle">
          <button
            aria-controls={detailId}
            aria-expanded={isExpanded}
            aria-label={`${project.line_id} 세부 정보 ${isExpanded ? '닫기' : '열기'}`}
            className="rounded-sm px-2 py-1 text-xs font-semibold text-muted transition-colors hover:bg-canvas hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            type="button"
            onClick={onToggle}
          >
            {isExpanded ? '닫기' : '세부'}
          </button>
        </td>
      </tr>
      <tr className="border-t border-border-subtle bg-canvas/50" hidden={!isExpanded} id={detailId}>
        <td className="px-4 py-3" colSpan={6}>
          <ProjectRowDetails project={project} />
        </td>
      </tr>
    </>
  )
}

function IdentityCell({ value }: { value: string }) {
  return (
    <td className="min-w-0 overflow-hidden px-4 py-0.5 align-middle">
      <span className="block min-w-0 truncate whitespace-nowrap font-mono text-xs font-semibold leading-4 text-ink-950" title={value}>
        {value}
      </span>
    </td>
  )
}

export function ProjectRowDetails({ project }: { project: ProjectSummaryOut }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.75fr)]">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <DetailItem label="버전" value={`v${project.version}`} />
        <DetailItem label="리비전 루트" value={project.revision_root_id ?? '-'} />
        <DetailItem label="이전 프로젝트" value={project.predecessor_project_id ?? '-'} />
        <DetailItem label="다음 프로젝트" value={project.successor_project_id ?? '-'} />
      </dl>
      <div>
        <p className="text-xs font-semibold text-muted">허용 액션</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {project.allowed_actions.length === 0 ? <span className="text-xs text-muted">없음</span> : null}
          {project.allowed_actions.map((action) => (
            <Badge className="shrink-0" key={action} tone="neutral">
              {actionLabel(action)}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-xs text-ink-950">{value}</dd>
    </div>
  )
}

function toggleExpandedProject(projectIds: number[], projectId: number): number[] {
  return projectIds.includes(projectId)
    ? projectIds.filter((id) => id !== projectId)
    : [...projectIds, projectId]
}

function formatUpdatedAt(value: string): string {
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return value

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(instant)
}

function statusBadgeTone(status: ProjectSummaryOut['status']) {
  if (status === 'draft') return 'draft'
  if (status === 'approved') return 'neutral'
  if (status === 'rejected') return 'error'
  return 'read-only'
}

function statusLabel(status: ProjectSummaryOut['status']) {
  switch (status) {
    case 'draft':
      return '초안'
    case 'review':
      return '검토중'
    case 'approved':
      return '승인'
    case 'rejected':
      return '반려'
    case 'archived':
      return '보존'
  }
}

function actionLabel(action: ProjectSummaryOut['allowed_actions'][number]) {
  switch (action) {
    case 'request_review':
      return '요청'
    case 'approve':
      return '승인'
    case 'reject':
      return '반려'
    case 'return_to_draft':
      return '초안복귀'
    case 'create_revision':
      return '리비전 생성'
  }
}
