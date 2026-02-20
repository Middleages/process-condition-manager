import { useState } from 'react'
import { useAdminExportSystems, useDeleteExportSystem } from '@/hooks/useExportAdmin'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ExportSystemForm } from '@/components/admin/ExportSystemForm'
import { ExportMappingManager } from '@/components/admin/ExportMappingManager'
import type { ExportSystemAdmin } from '@/types/export'
import { Plus, Pencil, Trash2, Settings } from 'lucide-react'

const FORMAT_BADGE_STYLES: Record<string, string> = {
  TYPE_A: 'bg-blue-100 text-blue-800 border-blue-200',
  TYPE_B: 'bg-green-100 text-green-800 border-green-200',
  TYPE_C: 'bg-purple-100 text-purple-800 border-purple-200',
}

export default function ExportSystemsPage() {
  const [selectedSystem, setSelectedSystem] = useState<ExportSystemAdmin | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [showMappings, setShowMappings] = useState(false)

  const { data: systems = [], isLoading } = useAdminExportSystems()
  const deleteMutation = useDeleteExportSystem()

  const handleAdd = () => {
    setSelectedSystem(null)
    setIsEditing(false)
    setIsFormOpen(true)
  }

  const handleEdit = (system: ExportSystemAdmin) => {
    setSelectedSystem(system)
    setIsEditing(true)
    setIsFormOpen(true)
  }

  const handleDelete = (system: ExportSystemAdmin) => {
    const message = `시스템 '${system.system_name}'과 연관된 컬럼 매핑 ${system.column_count}개가 함께 삭제됩니다. 계속하시겠습니까?`
    if (window.confirm(message)) {
      deleteMutation.mutate(system.id)
    }
  }

  const handleManageMappings = (system: ExportSystemAdmin) => {
    setSelectedSystem(system)
    setShowMappings(true)
  }

  const handleFormClose = () => {
    setIsFormOpen(false)
    if (!isEditing) {
      setSelectedSystem(null)
    }
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">전산 출력 시스템 관리</h1>
        <Button onClick={handleAdd}>
          <Plus className="h-4 w-4 mr-2" />
          시스템 추가
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      ) : systems.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          등록된 전산 출력 시스템이 없습니다.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">시스템 이름</th>
                <th className="px-4 py-3 text-left text-sm font-medium">포맷 타입</th>
                <th className="px-4 py-3 text-left text-sm font-medium">설명</th>
                <th className="px-4 py-3 text-left text-sm font-medium">상태</th>
                <th className="px-4 py-3 text-left text-sm font-medium">매핑 수</th>
                <th className="px-4 py-3 text-right text-sm font-medium">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {systems.map((system) => (
                <tr
                  key={system.id}
                  className={`hover:bg-muted/50 cursor-pointer ${
                    !system.is_active ? 'opacity-50 bg-muted/20' : ''
                  }`}
                  onClick={() => handleManageMappings(system)}
                >
                  <td className="px-4 py-3 text-sm font-medium">{system.system_name}</td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                        FORMAT_BADGE_STYLES[system.format_type] ?? 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {system.format_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {system.description ?? '--'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {system.is_active ? (
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
                    <Badge variant="outline">{system.column_count}</Badge>
                  </td>
                  <td
                    className="px-4 py-3 text-sm text-right space-x-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      title="매핑 관리"
                      onClick={() => handleManageMappings(system)}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="수정"
                      onClick={() => handleEdit(system)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="삭제"
                      onClick={() => handleDelete(system)}
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
      <div className="text-sm text-muted-foreground">총 {systems.length}개 시스템</div>

      {/* Mapping Manager Panel */}
      {showMappings && selectedSystem && (
        <ExportMappingManager
          system={selectedSystem}
          onClose={() => setShowMappings(false)}
        />
      )}

      {/* Add / Edit Form Modal */}
      <ExportSystemForm
        isOpen={isFormOpen}
        onClose={handleFormClose}
        system={isEditing ? selectedSystem : null}
      />
    </div>
  )
}
