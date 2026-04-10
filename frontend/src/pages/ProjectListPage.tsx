import { useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useProjects } from '@/hooks/useProjects'
import { useLines } from '@/hooks/useLines'
import { StatusBadge } from '@/components/projects/StatusBadge'
import { ProjectCreateModalV2 } from '@/components/projects/ProjectCreateModalV2'
import { VersionHistoryModal } from '@/components/projects/VersionHistoryModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ProjectStatus } from '@/types'
import { Plus, Search, Loader2, History } from 'lucide-react'

const VALID_STATUSES: ProjectStatus[] = ['draft', 'review', 'approved', 'rejected']

const STATUS_FILTERS: { label: string; value: ProjectStatus | 'all' }[] = [
  { label: '전체', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Review', value: 'review' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
]

export default function ProjectListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const paramStatus = searchParams.get('status') as ProjectStatus | null
  const statusFilter: ProjectStatus | 'all' =
    paramStatus && VALID_STATUSES.includes(paramStatus) ? paramStatus : 'all'
  const lineFilter = searchParams.get('line_id')
    ? Number(searchParams.get('line_id'))
    : undefined

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, val] of Object.entries(updates)) {
          if (val == null || val === '') next.delete(key)
          else next.set(key, val)
        }
        return next
      })
    },
    [setSearchParams],
  )

  const [searchText, setSearchText] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [isLatestOnly, setIsLatestOnly] = useState(true)
  const [historyLineId, setHistoryLineId] = useState<number | null>(null)
  const [historyProcess, setHistoryProcess] = useState<string | null>(null)
  const [historyPartId, setHistoryPartId] = useState<string | null>(null)
  const [historyProjectId, setHistoryProjectId] = useState<number>(0)

  const { data: lines = [] } = useLines()
  const queryStatus = statusFilter === 'all' ? undefined : statusFilter
  const { data: projects = [], isLoading } = useProjects(queryStatus, lineFilter)

  const filtered = searchText
    ? projects.filter((p) =>
        p.condition_name.toLowerCase().includes(searchText.toLowerCase())
      )
    : projects

  const displayProjects = isLatestOnly ? filtered.filter((p) => p.is_latest) : filtered

  return (
    <div className="h-full flex flex-col p-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.value}
                variant={statusFilter === f.value ? 'default' : 'outline'}
                size="sm"
                aria-pressed={statusFilter === f.value}
                onClick={() => updateParams({ status: f.value === 'all' ? undefined : f.value })}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <select
            value={lineFilter ?? ''}
            onChange={(e) => updateParams({ line_id: e.target.value || undefined })}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">전체 라인</option>
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.line_name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="latest-only"
              checked={isLatestOnly}
              onChange={(e) => setIsLatestOnly(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="latest-only" className="text-sm">
              최신 버전만 표시
            </label>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="제품명 검색..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-9 w-60"
            />
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            새 공정 조건표
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0">
            <tr className="border-b">
              <th className="text-left px-4 py-3 font-medium w-12">#</th>
              <th className="text-left px-4 py-3 font-medium">제품명</th>
              <th className="text-left px-4 py-3 font-medium w-24">라인</th>
              <th className="text-left px-4 py-3 font-medium">Backbone</th>
              <th className="text-left px-4 py-3 font-medium w-20">레이어</th>
              <th className="text-left px-4 py-3 font-medium w-24">버전</th>
              <th className="text-left px-4 py-3 font-medium w-24">상태</th>
              <th className="text-left px-4 py-3 font-medium w-24">생성자</th>
              <th className="text-left px-4 py-3 font-medium w-40">수정일</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="text-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </td>
              </tr>
            ) : displayProjects.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-12 text-muted-foreground">
                  공정 조건표가 없습니다.
                </td>
              </tr>
            ) : (
              displayProjects.map((project) => (
                <tr
                  key={project.id}
                  className="border-b hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 text-muted-foreground">{project.id}</td>
                  <td
                    className="px-4 py-3 font-medium cursor-pointer hover:text-blue-600"
                    onClick={() => navigate(`/process-conditions/${project.id}/edit`)}
                  >
                    {project.condition_name}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{project.line_name ?? '-'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{project.backbone_condition_name ?? '-'}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{project.layer_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">v{project.revision}</span>
                      {project.revision > 1 && project.line_id != null && project.process && project.part_id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setHistoryLineId(project.line_id)
                            setHistoryProcess(project.process)
                            setHistoryPartId(project.part_id)
                            setHistoryProjectId(project.id)
                          }}
                          className="text-blue-600 hover:text-blue-800"
                          title="버전 히스토리 보기"
                        >
                          <History className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={project.status} />
                  </td>
                  <td className="px-4 py-3">{project.creator_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(project.updated_at).toLocaleDateString('ko-KR', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ProjectCreateModalV2 open={createOpen} onOpenChange={setCreateOpen} />

      <VersionHistoryModal
        open={historyLineId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryLineId(null)
            setHistoryProcess(null)
            setHistoryPartId(null)
            setHistoryProjectId(0)
          }
        }}
        lineId={historyLineId}
        process={historyProcess}
        partId={historyPartId}
        currentProjectId={historyProjectId}
      />
    </div>
  )
}
