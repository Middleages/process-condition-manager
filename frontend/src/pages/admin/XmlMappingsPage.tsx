import { useState, useMemo } from 'react'
import { useAdminMappings, useDeleteMapping } from '@/hooks/useAdminMappings'
import { useAuthStore } from '@/stores/useAuthStore'
import { canWrite } from '@/lib/permissions'
import type { UserRole } from '@/types/user'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { MappingFormModal } from '@/components/admin/MappingFormModal'
import type { XmlMapping } from '@/types'
import { Pencil, Trash2, Plus, Search } from 'lucide-react'

type SortField = 'xpath' | 'column_name'
type SortOrder = 'asc' | 'desc'

export default function XmlMappingsPage() {
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(undefined)
  const [sortField, setSortField] = useState<SortField>('xpath')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<XmlMapping | undefined>()

  const { data: mappings = [], isLoading } = useAdminMappings(search, activeFilter)
  const deleteMutation = useDeleteMapping()
  const userRoles = useAuthStore((s) => s.user?.roles) as UserRole[] | undefined
  // XML 매핑은 system_config 카테고리 -> developer 역할만 쓰기 가능
  const readOnly = !canWrite(userRoles, 'system_config')

  // Client-side sorting
  const sortedMappings = useMemo(() => {
    const filtered = [...mappings]
    filtered.sort((a, b) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      return sortOrder === 'asc' ? cmp : -cmp
    })
    return filtered
  }, [mappings, sortField, sortOrder])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const handleAdd = () => {
    setEditingMapping(undefined)
    setModalOpen(true)
  }

  const handleEdit = (mapping: XmlMapping) => {
    setEditingMapping(mapping)
    setModalOpen(true)
  }

  const handleDelete = (id: number) => {
    if (confirm('정말 삭제하시겠습니까?')) {
      deleteMutation.mutate(id)
    }
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">XML 매핑 관리</h1>
        {!readOnly ? (
          <Button onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-2" />
            신규 추가
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">읽기 전용</span>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="XPath 또는 컬럼명 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-2">
          <Button
            variant={activeFilter === undefined ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter(undefined)}
          >
            전체
          </Button>
          <Button
            variant={activeFilter === true ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter(true)}
          >
            활성
          </Button>
          <Button
            variant={activeFilter === false ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter(false)}
          >
            비활성
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      ) : sortedMappings.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          매핑 데이터가 없습니다.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th
                  className="px-4 py-3 text-left text-sm font-medium cursor-pointer hover:bg-muted/80"
                  onClick={() => handleSort('xpath')}
                >
                  XPath {sortField === 'xpath' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  className="px-4 py-3 text-left text-sm font-medium cursor-pointer hover:bg-muted/80"
                  onClick={() => handleSort('column_name')}
                >
                  컬럼명 {sortField === 'column_name' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">카테고리</th>
                <th className="px-4 py-3 text-left text-sm font-medium">타입</th>
                <th className="px-4 py-3 text-left text-sm font-medium">변환</th>
                <th className="px-4 py-3 text-left text-sm font-medium">상태</th>
                <th className="px-4 py-3 text-right text-sm font-medium">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sortedMappings.map((mapping) => (
                <tr key={mapping.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 text-sm font-mono text-xs">
                    {mapping.xpath}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div>{mapping.column_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {mapping.display_name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant="outline">{mapping.category_code}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm">{mapping.data_type}</td>
                  <td className="px-4 py-3 text-sm">
                    {mapping.value_transform || '--'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant={mapping.is_active ? 'default' : 'secondary'}>
                      {mapping.is_active ? '활성' : '비활성'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-right space-x-2">
                    {!readOnly && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(mapping)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(mapping.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="text-sm text-muted-foreground">
        총 {sortedMappings.length}개 매핑
      </div>

      {/* Modal */}
      <MappingFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        mapping={editingMapping}
      />
    </div>
  )
}
