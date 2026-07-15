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
      <table className="w-full min-w-[920px] table-fixed text-left text-sm">
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
                <Badge tone="draft">초안</Badge>
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
