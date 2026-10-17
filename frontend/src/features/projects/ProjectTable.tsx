import { Link } from 'react-router-dom'

import type { ProjectSummaryOut } from '@/api/types'

export interface ProjectTableProps {
  projects: ProjectSummaryOut[]
  from: string
  onProjectOpen: (projectId: number) => void
}

export function ProjectTable({ projects, from, onProjectOpen }: ProjectTableProps) {
  return (
    <div className="max-w-full overflow-x-auto rounded-[3px] border border-border-subtle bg-surface">
      <table className="w-full min-w-[590px] table-fixed text-left text-sm">
        <thead className="bg-canvas text-xs font-semibold text-muted">
          <tr className="h-10">
            <th className="w-[27%] px-4" scope="col">Process</th>
            <th className="w-[25%] px-4" scope="col">Part ID</th>
            <th className="w-[16%] px-3" scope="col">상태</th>
            <th className="w-[17%] px-3" scope="col">수정일</th>
            <th className="w-[15%] px-3" scope="col">공정조건 열기</th>
          </tr>
        </thead>
        <tbody>
          {projects.map(project => (
            <tr className="h-[66px] border-t border-border-subtle hover:bg-canvas/70" key={project.id}>
              <td className="px-4 py-3 align-middle">
                <span className="block break-words font-mono text-base font-bold leading-snug [overflow-wrap:anywhere]">{project.process_id}</span>
                <span className="mt-1 block text-xs text-muted">v{project.version}</span>
              </td>
              <td className="px-4 py-3 align-middle">
                <span className="block break-words font-mono text-base font-semibold leading-snug [overflow-wrap:anywhere]">{project.part_id}</span>
              </td>
              <td className="px-3 py-3 align-middle">
                <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-sm font-bold ${STATUS_STYLES[project.status]}`}>
                  {STATUS_LABELS[project.status]}
                </span>
              </td>
              <td className="px-3 py-3 text-xs tabular-nums text-muted">
                <time dateTime={project.updated_at}>{formatUpdatedAt(project.updated_at)}</time>
              </td>
              <td className="px-3 py-3 align-middle">
                <Link
                  aria-label={`${project.line_id} ${project.process_id} ${project.part_id} 공정조건 열기`}
                  className="inline-flex min-h-9 items-center justify-center rounded-[3px] border border-brand-700 bg-surface px-3 text-sm font-bold text-brand-700 hover:bg-brand-700 hover:text-white"
                  data-project-id={project.id}
                  state={{ from }}
                  to={`/projects/${project.id}`}
                  onClick={() => onProjectOpen(project.id)}
                >열기</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const STATUS_STYLES: Record<ProjectSummaryOut['status'], string> = {
  draft: 'border-slate-300 bg-slate-100 text-slate-700',
  review: 'border-amber-300 bg-amber-50 text-amber-900',
  approved: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  rejected: 'border-red-300 bg-red-50 text-red-800',
  archived: 'border-slate-300 bg-slate-100 text-slate-700',
}
const STATUS_LABELS: Record<ProjectSummaryOut['status'], string> = {
  draft: '작성 중', review: '검토 중', approved: '승인됨', rejected: '반려', archived: '보존',
}

function formatUpdatedAt(value: string): string {
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? value : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short' }).format(instant)
}
