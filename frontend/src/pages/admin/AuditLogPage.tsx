import { useMemo, useState } from 'react'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Combobox } from '@/components/ui/combobox'
import { useAuditLogs } from '@/hooks/useAdminAudit'
import { useUsers } from '@/hooks/useUsers'
import { useProjects } from '@/hooks/useProjects'
import { useLines } from '@/hooks/useLines'

const LIMIT = 50

function changeTypeBadge(type: string) {
  if (type === 'backbone') return 'bg-blue-100 text-blue-800'
  if (type === 'recipe') return 'bg-purple-100 text-purple-800'
  return 'bg-gray-100 text-gray-700'
}

function changeTypeLabel(type: string) {
  if (type === 'backbone') return 'Backbone'
  if (type === 'recipe') return 'Recipe'
  return '수동'
}

export default function AuditLogPage() {
  const [projectIdInput, setProjectIdInput] = useState('')
  const [lineIdInput, setLineIdInput] = useState('')
  const [changedByInput, setChangedByInput] = useState('')
  const [changeTypeInput, setChangeTypeInput] = useState('')
  const [dateFromInput, setDateFromInput] = useState('')
  const [dateToInput, setDateToInput] = useState('')
  const [offset, setOffset] = useState(0)

  // Applied filter state
  const [appliedFilters, setAppliedFilters] = useState({
    project_id: undefined as number | undefined,
    line_id: undefined as number | undefined,
    changed_by: undefined as number | undefined,
    change_type: '',
    date_from: '',
    date_to: '',
  })

  const { data: users = [] } = useUsers()
  const { data: projects = [] } = useProjects()
  const { data: lines = [] } = useLines()

  const projectOptions = useMemo(() => {
    const filtered = lineIdInput
      ? projects.filter((p) => p.line_id === Number(lineIdInput))
      : projects
    return [
      { value: '', label: '전체' },
      ...filtered.map((p) => ({
        value: p.id.toString(),
        label: `${p.product_name} (v${p.revision})`,
      })),
    ]
  }, [projects, lineIdInput])

  const { data, isLoading } = useAuditLogs({
    ...appliedFilters,
    change_type: appliedFilters.change_type || undefined,
    date_from: appliedFilters.date_from || undefined,
    date_to: appliedFilters.date_to || undefined,
    offset,
    limit: LIMIT,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / LIMIT)
  const currentPage = Math.floor(offset / LIMIT) + 1

  const handleApplyFilters = () => {
    setOffset(0)
    setAppliedFilters({
      project_id: projectIdInput ? parseInt(projectIdInput) : undefined,
      line_id: lineIdInput ? parseInt(lineIdInput) : undefined,
      changed_by: changedByInput ? parseInt(changedByInput) : undefined,
      change_type: changeTypeInput,
      date_from: dateFromInput,
      date_to: dateToInput,
    })
  }

  const handleLineChange = (value: string) => {
    setLineIdInput(value)
    // Reset project selection when line changes
    setProjectIdInput('')
  }

  const handlePrev = () => setOffset((prev) => Math.max(0, prev - LIMIT))
  const handleNext = () => setOffset((prev) => prev + LIMIT)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">변경 이력 조회</h1>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 mb-4 p-4 bg-muted/50 rounded-lg items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">라인</label>
          <select
            className="border border-input rounded-md px-3 py-2 text-sm bg-background h-9"
            value={lineIdInput}
            onChange={(e) => handleLineChange(e.target.value)}
          >
            <option value="">전체</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id.toString()}>{l.line_name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">프로젝트</label>
          <Combobox
            options={projectOptions}
            value={projectIdInput}
            onChange={setProjectIdInput}
            placeholder="전체"
            searchPlaceholder="프로젝트 검색..."
            className="w-[220px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">변경자</label>
          <select
            className="border border-input rounded-md px-3 py-2 text-sm bg-background h-9"
            value={changedByInput}
            onChange={(e) => setChangedByInput(e.target.value)}
          >
            <option value="">전체</option>
            {users.map((u) => (
              <option key={u.id} value={u.id.toString()}>{u.userid}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">변경 유형</label>
          <select
            className="border border-input rounded-md px-3 py-2 text-sm bg-background h-9"
            value={changeTypeInput}
            onChange={(e) => setChangeTypeInput(e.target.value)}
          >
            <option value="">전체</option>
            <option value="manual">수동</option>
            <option value="backbone">Backbone</option>
            <option value="recipe">Recipe</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">시작일</label>
          <Input
            type="date"
            value={dateFromInput}
            onChange={(e) => setDateFromInput(e.target.value)}
            className="w-36"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">종료일</label>
          <Input
            type="date"
            value={dateToInput}
            onChange={(e) => setDateToInput(e.target.value)}
            className="w-36"
          />
        </div>
        <Button onClick={handleApplyFilters} size="sm">
          <Search className="h-4 w-4 mr-1" />
          적용
        </Button>
      </div>

      {/* Results */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">프로젝트</th>
              <th className="px-4 py-3 text-left font-medium">레이어</th>
              <th className="px-4 py-3 text-left font-medium">컬럼</th>
              <th className="px-4 py-3 text-left font-medium">이전 값</th>
              <th className="px-4 py-3 text-left font-medium">변경 값</th>
              <th className="px-4 py-3 text-left font-medium">유형</th>
              <th className="px-4 py-3 text-left font-medium">변경자</th>
              <th className="px-4 py-3 text-left font-medium">변경 시각</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">로딩 중...</td>
              </tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">변경 이력이 없습니다.</td>
              </tr>
            )}
            {items.map((entry) => (
              <tr key={entry.id} className="border-t hover:bg-muted/50">
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {entry.project_name ?? `#${entry.project_id}`}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{entry.layer_name ?? '-'}</td>
                <td className="px-4 py-3 font-mono text-xs">{entry.column_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{entry.old_value ?? '-'}</td>
                <td className="px-4 py-3">{entry.new_value ?? '-'}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${changeTypeBadge(entry.change_type)}`}
                  >
                    {changeTypeLabel(entry.change_type)}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{entry.changed_by_name ?? '-'}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {new Date(entry.changed_at).toLocaleString('ko-KR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            전체 {total}건 중 {offset + 1}~{Math.min(offset + LIMIT, total)}건
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrev}
              disabled={offset === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              이전
            </Button>
            <span className="text-sm">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNext}
              disabled={offset + LIMIT >= total}
            >
              다음
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
