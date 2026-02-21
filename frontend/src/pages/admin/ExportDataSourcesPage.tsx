import { useState } from 'react'
import { useExportDataSources, useDeleteDataSource } from '@/hooks/useExportDataSources'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ExportDataSourceForm } from '@/components/admin/ExportDataSourceForm'
import type { ExportDataSource, JoinKeyMapping } from '@/types/export'
import { Plus, Pencil, Trash2 } from 'lucide-react'

function JoinKeysSummary({ mappings }: { mappings: JoinKeyMapping[] }) {
  if (mappings.length === 0) return <span className="text-muted-foreground">--</span>
  return (
    <span className="text-xs text-muted-foreground">
      {mappings.map((m) => `${m.external_column} ↔ ${m.pcm_field}`).join(', ')}
    </span>
  )
}

export default function ExportDataSourcesPage() {
  const [selectedSource, setSelectedSource] = useState<ExportDataSource | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const { data: sources = [], isLoading } = useExportDataSources()
  const deleteMutation = useDeleteDataSource()

  const handleAdd = () => {
    setSelectedSource(null)
    setIsEditing(false)
    setIsFormOpen(true)
  }

  const handleEdit = (source: ExportDataSource) => {
    setSelectedSource(source)
    setIsEditing(true)
    setIsFormOpen(true)
  }

  const handleDelete = (source: ExportDataSource) => {
    const hasRelatedMappings = source.mapping_count > 0
    const message = hasRelatedMappings
      ? `데이터 소스 '${source.source_name}'은 ${source.mapping_count}개의 매핑에서 참조됩니다. 비활성 처리(Soft Delete)됩니다. 계속하시겠습니까?`
      : `데이터 소스 '${source.source_name}'을 삭제하시겠습니까?`
    if (window.confirm(message)) {
      deleteMutation.mutate(source.id)
    }
  }

  const handleFormClose = () => {
    setIsFormOpen(false)
    if (!isEditing) {
      setSelectedSource(null)
    }
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">외부 데이터 소스 관리</h1>
        <Button onClick={handleAdd}>
          <Plus className="h-4 w-4 mr-2" />
          데이터 소스 추가
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        전산 출력 시 조건표 데이터와 함께 병합할 외부 DB 테이블을 등록합니다.
      </p>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      ) : sources.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          등록된 외부 데이터 소스가 없습니다.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">소스 이름</th>
                <th className="px-4 py-3 text-left text-sm font-medium">테이블명</th>
                <th className="px-4 py-3 text-left text-sm font-medium">스키마</th>
                <th className="px-4 py-3 text-left text-sm font-medium">JOIN 키</th>
                <th className="px-4 py-3 text-left text-sm font-medium">상태</th>
                <th className="px-4 py-3 text-left text-sm font-medium">매핑 수</th>
                <th className="px-4 py-3 text-right text-sm font-medium">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sources.map((source) => (
                <tr
                  key={source.id}
                  className={`hover:bg-muted/50 ${
                    !source.is_active ? 'opacity-50 bg-muted/20' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-sm font-medium">{source.source_name}</td>
                  <td className="px-4 py-3 text-sm font-mono text-xs">{source.table_name}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {source.schema_name}
                  </td>
                  <td className="px-4 py-3 text-sm max-w-xs">
                    <JoinKeysSummary mappings={source.join_key_mappings} />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {source.is_active ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />
                        <span className="text-green-700 text-xs">활성</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-gray-400 inline-block" />
                        <span className="text-gray-500 text-xs">비활성</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant="outline">{source.mapping_count}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-right space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="수정"
                      onClick={() => handleEdit(source)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="삭제"
                      onClick={() => handleDelete(source)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="text-sm text-muted-foreground">총 {sources.length}개 데이터 소스</div>

      {/* Add / Edit Form Modal */}
      <ExportDataSourceForm
        isOpen={isFormOpen}
        onClose={handleFormClose}
        dataSource={isEditing ? selectedSource : null}
      />
    </div>
  )
}
