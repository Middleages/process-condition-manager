import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { ProjectSummaryOut } from '@/api/types'
import { Badge } from '@/shared/components/Badge'

export interface ProjectTableProps {
  projects: ProjectSummaryOut[]
  from: string
  onProjectOpen: (projectId: number) => void
}

export function ProjectTable({ projects, from, onProjectOpen }: ProjectTableProps) {
  return (
    <div className="max-w-full overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="w-full min-w-[760px] table-fixed text-left text-sm">
        <thead className="bg-canvas text-xs font-semibold uppercase tracking-wide text-muted">
          <tr className="h-9">
            <th className="w-[34%] px-4 py-0" scope="col">
              프로젝트명
            </th>
            <th className="w-[26%] px-4 py-0" scope="col">
              Line / Process
            </th>
            <th className="w-[12%] px-4 py-0" scope="col">
              상태
            </th>
            <th className="w-[10%] px-4 py-0 text-right" scope="col">
              Layer
            </th>
            <th className="w-[12%] px-4 py-0 text-right" scope="col">
              Cell
            </th>
            <th className="w-[6%] px-3 py-0" scope="col">
              <span className="sr-only">상세</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id} className="h-9 border-t border-border-subtle hover:bg-canvas/70">
              <td className="px-4 py-0.5 align-middle">
                <Link
                  className="block w-fit max-w-full rounded-sm font-semibold leading-4 text-ink-950 underline decoration-transparent underline-offset-4 transition-colors hover:text-brand-700 hover:decoration-current"
                  data-project-id={project.id}
                  state={{ from }}
                  to={`/projects/${project.id}`}
                  onClick={() => onProjectOpen(project.id)}
                >
                  {project.name}
                </Link>
                {project.description ? (
                  <p className="truncate text-[11px] leading-3 text-muted">{project.description}</p>
                ) : null}
              </td>
              <td className="px-4 py-0.5 align-middle">
                <span className="block font-mono text-xs font-semibold leading-4 text-ink-950">
                  {project.line_id} / {project.process_id}
                </span>
                <span className="block truncate font-mono text-[11px] leading-3 text-muted">
                  {project.part_id}
                </span>
              </td>
              <td className="px-4 py-0 align-middle">
                <Badge tone="draft">초안</Badge>
              </td>
              <td className="px-4 py-0 text-right font-mono text-xs tabular-nums text-ink-950">
                {project.layer_count}
              </td>
              <td className="px-4 py-0 text-right font-mono text-xs tabular-nums text-ink-950">
                {project.cell_count}
              </td>
              <td className="px-3 py-0 text-right text-muted">
                <ChevronRight aria-hidden="true" className="ml-auto" size={18} strokeWidth={2} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
