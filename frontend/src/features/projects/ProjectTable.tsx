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
            <th className="w-[34%] whitespace-nowrap px-4 py-0" scope="col">
              프로젝트명
            </th>
            <th className="w-[26%] whitespace-nowrap px-4 py-0" scope="col">
              Line / Process
            </th>
            <th className="w-[12%] whitespace-nowrap px-4 py-0" scope="col">
              상태
            </th>
            <th className="w-[10%] whitespace-nowrap px-4 py-0 text-right" scope="col">
              Layer
            </th>
            <th className="w-[12%] whitespace-nowrap px-4 py-0 text-right" scope="col">
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
                {project.description ? (
                  <p
                    className="min-w-0 truncate whitespace-nowrap text-xs leading-3 text-muted"
                    title={project.description}
                  >
                    {project.description}
                  </p>
                ) : null}
              </td>
              <td className="min-w-0 overflow-hidden px-4 py-0.5 align-middle">
                <span
                  className="block min-w-0 truncate whitespace-nowrap font-mono text-xs font-semibold leading-4 text-ink-950"
                  title={`${project.line_id} / ${project.process_id}`}
                >
                  {project.line_id} / {project.process_id}
                </span>
                <span
                  className="block min-w-0 truncate whitespace-nowrap font-mono text-xs leading-3 text-muted"
                  title={project.part_id}
                >
                  {project.part_id}
                </span>
              </td>
              <td className="min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 align-middle">
                <Badge tone="draft">초안</Badge>
              </td>
              <td className="min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 text-right font-mono text-xs tabular-nums text-ink-950">
                {project.layer_count}
              </td>
              <td className="min-w-0 overflow-hidden whitespace-nowrap px-4 py-0 text-right font-mono text-xs tabular-nums text-ink-950">
                {project.cell_count}
              </td>
              <td className="min-w-0 overflow-hidden whitespace-nowrap px-3 py-0 text-right text-muted">
                <ChevronRight aria-hidden="true" className="ml-auto" size={18} strokeWidth={2} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
