import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjects } from '@/hooks/useProjects'
import { StatusBadge } from '@/components/projects/StatusBadge'
import { ProjectCreateModal } from '@/components/projects/ProjectCreateModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ProjectStatus } from '@/types'
import { Plus, Search, Loader2 } from 'lucide-react'

const STATUS_FILTERS: { label: string; value: ProjectStatus | 'all' }[] = [
  { label: '전체', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Review', value: 'review' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
]

export default function ProjectListPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [searchText, setSearchText] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const queryStatus = statusFilter === 'all' ? undefined : statusFilter
  const { data: projects = [], isLoading } = useProjects(queryStatus)

  const filtered = searchText
    ? projects.filter((p) =>
        p.product_name.toLowerCase().includes(searchText.toLowerCase())
      )
    : projects

  return (
    <div className="h-full flex flex-col p-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={statusFilter === f.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
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
            새 프로젝트
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
              <th className="text-left px-4 py-3 font-medium">Backbone</th>
              <th className="text-left px-4 py-3 font-medium w-20">레이어</th>
              <th className="text-left px-4 py-3 font-medium w-24">상태</th>
              <th className="text-left px-4 py-3 font-medium w-24">생성자</th>
              <th className="text-left px-4 py-3 font-medium w-40">수정일</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="text-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-muted-foreground">
                  프로젝트가 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((project) => (
                <tr
                  key={project.id}
                  className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => navigate(`/projects/${project.id}/edit`)}
                >
                  <td className="px-4 py-3 text-muted-foreground">{project.id}</td>
                  <td className="px-4 py-3 font-medium">{project.product_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{project.backbone_name}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{project.layer_count}</td>
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

      <ProjectCreateModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
