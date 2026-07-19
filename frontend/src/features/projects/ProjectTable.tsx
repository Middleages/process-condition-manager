import { Link } from 'react-router-dom'

import type { ChoiceValueOut, ProjectSummaryOut } from '@/api/types'
import { Badge } from '@/shared/components/Badge'

export interface ProjectTableProps {
  projects: ProjectSummaryOut[]
  from: string
  onProjectOpen: (projectId: number) => void
}

export function ProjectTable({ projects, from, onProjectOpen }: ProjectTableProps) {
  return (
    <div className="max-w-full overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="w-full min-w-[1120px] table-fixed text-left text-sm">
        <thead className="bg-canvas text-xs font-semibold uppercase tracking-wide text-muted">
          <tr className="h-9">
            <th className="w-[20%] whitespace-nowrap px-4 py-0" scope="col">
              프로젝트명
            </th>
            <th className="w-[16%] whitespace-nowrap px-4 py-0" scope="col">
              LINE / Process
            </th>
            <th className="w-[12%] whitespace-nowrap px-4 py-0" scope="col">
              PARTID
            </th>
            <th className="w-[14%] whitespace-nowrap px-4 py-0" scope="col">
              Device Type
            </th>
            <th className="w-[14%] whitespace-nowrap px-4 py-0" scope="col">
              Category
            </th>
            <th
              className="hidden 2xl:table-cell w-[8%] whitespace-nowrap px-4 py-0 text-right"
              scope="col"
            >
              Layer Total
            </th>
            <th className="w-[8%] whitespace-nowrap px-4 py-0" scope="col">
              상태
            </th>
            <th className="w-[14%] whitespace-nowrap px-4 py-0" scope="col">
              Lineage
            </th>
            <th className="w-[18%] whitespace-nowrap px-4 py-0" scope="col">
              허용 액션
            </th>
            <th
              className="hidden xl:table-cell w-[12%] whitespace-nowrap px-4 py-0"
              scope="col"
            >
              Updated
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id} className="h-9 border-t border-border-subtle hover:bg-canvas/70">
              <td className="min-w-0 overflow-hidden px-4 py-0.5 align-middle">
                <Link
                  className="block min-w-0 max-w-full truncate whitespace-nowrap rounded-sm font-semibold leading-4 text-ink-950 underline decoration-transparent underline-offset-4 transition-colors hover:text-brand-700 hover:decoration-current"
                  data-project-id={project.id}
                  state={{ from }}
                  title={project.name}
                  to={`/projects/${project.id}`}
                  onClick={() => onProjectOpen(project.id)}
                >
                  {project.name}
                </Link>
              </td>
              <td className="min-w-0 overflow-hidden px-4 py-0.5 align-middle">
                <span
                  className="block min-w-0 truncate whitespace-nowrap font-mono text-xs font-semibold leading-4 text-ink-950"
                  title={`${project.line_id} / ${project.process_id}`}
                >
                  {project.line_id} / {project.process_id}
                </span>
              </td>
              <td className="min-w-0 overflow-hidden px-4 py-0.5 align-middle">
                <span
                  className="block min-w-0 truncate whitespace-nowrap font-mono text-xs text-ink-950"
                  title={project.part_id}
                >
                  {project.part_id}
                </span>
              </td>
              <ChoiceCell choice={project.device_type} />
              <ChoiceCell choice={project.project_category} />
              <td className="hidden 2xl:table-cell min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 text-right font-mono text-xs tabular-nums text-ink-950">
                {project.layer_total ?? '-'}
              </td>
              <td className="min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 align-middle">
                <Badge tone={statusBadgeTone(project.status)}>{statusLabel(project.status)}</Badge>
              </td>
              <td className="min-w-0 overflow-hidden px-4 py-0.5 align-middle font-mono text-xs text-muted">
                <span
                  className="block min-w-0 truncate"
                  title={`v${project.version} · root=${project.revision_root_id ?? '-'} · pred=${project.predecessor_project_id ?? '-'} · succ=${project.successor_project_id ?? '-'}`}
                >
                  v{project.version} · root:{project.revision_root_id ?? '-'} · pred:{
                    project.predecessor_project_id ?? '-'
                  } · succ:{project.successor_project_id ?? '-'}
                </span>
              </td>
              <td className="min-w-0 overflow-hidden px-4 py-0 align-middle">
                <div className="flex min-w-0 flex-wrap gap-1">
                  {project.allowed_actions.length === 0 ? (
                    <span className="text-xs text-muted">없음</span>
                  ) : null}
                  {project.allowed_actions.map((action) => (
                    <Badge className="shrink-0" key={action} tone="neutral">
                      {actionLabel(action)}
                    </Badge>
                  ))}
                </div>
              </td>
              <td className="hidden xl:table-cell min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 text-xs tabular-nums text-muted">
                <time dateTime={project.updated_at}>{formatUpdatedAt(project.updated_at)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChoiceCell({ choice }: { choice: ChoiceValueOut }) {
  const label = choice.label.trim() || choice.code
  const title = choice.label.trim() === '' ? choice.code : `${choice.code} · ${choice.label}`

  return (
    <td className="min-w-0 overflow-hidden px-4 py-0.5 align-middle" title={title}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate whitespace-nowrap text-xs font-medium text-ink-950">
          {label}
        </span>
        {!choice.is_active ? (
          <Badge className="shrink-0" tone="warning">
            사용 중지됨
          </Badge>
        ) : null}
      </span>
    </td>
  )
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
