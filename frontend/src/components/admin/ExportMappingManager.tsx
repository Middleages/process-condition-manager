// ExportMappingManager.tsx
// Panel that displays and manages column mappings for a specific export system.
// Supports add, edit, delete, and reorder operations.

import { useState } from 'react'
import { useExportMappings, useDeleteExportMapping, useReorderExportMappings } from '@/hooks/useExportAdmin'
import type { ExportSystemAdmin, ExportMapping } from '@/types/export'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, X, Loader2, Check } from 'lucide-react'
import { ExportMappingForm } from '@/components/admin/ExportMappingForm'

interface ExportMappingManagerProps {
  system: ExportSystemAdmin
  onClose: () => void
}

const CATEGORY_BADGE_STYLES: Record<string, string> = {
  SP: 'bg-blue-100 text-blue-800 border-blue-200',
  SC: 'bg-green-100 text-green-800 border-green-200',
  OVL: 'bg-orange-100 text-orange-800 border-orange-200',
  DEV: 'bg-purple-100 text-purple-800 border-purple-200',
}

export function ExportMappingManager({ system, onClose }: ExportMappingManagerProps) {
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<ExportMapping | null>(null)

  const { data: mappings = [], isLoading } = useExportMappings(system.id)
  const deleteMutation = useDeleteExportMapping(system.id)
  const reorderMutation = useReorderExportMappings(system.id)

  const handleAdd = () => {
    setEditingMapping(null)
    setIsFormOpen(true)
  }

  const handleEdit = (mapping: ExportMapping) => {
    setEditingMapping(mapping)
    setIsFormOpen(true)
  }

  const handleFormClose = () => {
    setIsFormOpen(false)
    setEditingMapping(null)
  }

  const handleDelete = (mapping: ExportMapping) => {
    const message = `매핑 '${mapping.target_column_name}'을 삭제하시겠습니까?`
    if (window.confirm(message)) {
      deleteMutation.mutate(mapping.id)
    }
  }

  const handleMoveUp = (index: number) => {
    if (index === 0) return
    const orderedIds = mappings.map((m) => m.id)
    const temp = orderedIds[index - 1]
    orderedIds[index - 1] = orderedIds[index]
    orderedIds[index] = temp
    reorderMutation.mutate(orderedIds)
  }

  const handleMoveDown = (index: number) => {
    if (index === mappings.length - 1) return
    const orderedIds = mappings.map((m) => m.id)
    const temp = orderedIds[index + 1]
    orderedIds[index + 1] = orderedIds[index]
    orderedIds[index] = temp
    reorderMutation.mutate(orderedIds)
  }

  return (
    <div className="border rounded-lg overflow-hidden mt-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted border-b">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">
            {system.system_name} — 컬럼 매핑 관리
          </h2>
          <Badge variant="outline">{mappings.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-1" />
            매핑 추가
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} title="닫기">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>로딩 중...</span>
        </div>
      ) : mappings.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          등록된 매핑이 없습니다
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium w-8">#</th>
                <th className="px-4 py-2 text-left font-medium">컬럼명</th>
                <th className="px-4 py-2 text-left font-medium">카테고리</th>
                <th className="px-4 py-2 text-left font-medium">출력 컬럼명</th>
                <th className="px-4 py-2 text-center font-medium">필수</th>
                <th className="px-4 py-2 text-right font-medium">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {mappings.map((mapping, index) => (
                <tr key={mapping.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2 text-muted-foreground">{mapping.sort_order}</td>
                  <td className="px-4 py-2 font-mono text-xs">{mapping.column_name}</td>
                  <td className="px-4 py-2">
                    {mapping.category_code ? (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                          CATEGORY_BADGE_STYLES[mapping.category_code] ?? 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {mapping.category_code}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{mapping.target_column_name}</td>
                  <td className="px-4 py-2 text-center">
                    {mapping.is_required ? (
                      <Check className="h-4 w-4 text-green-600 inline-block" />
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right space-x-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0 || reorderMutation.isPending}
                      title="위로"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleMoveDown(index)}
                      disabled={index === mappings.length - 1 || reorderMutation.isPending}
                      title="아래로"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleEdit(mapping)}
                      title="수정"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(mapping)}
                      disabled={deleteMutation.isPending}
                      title="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Form Modal */}
      <ExportMappingForm
        isOpen={isFormOpen}
        onClose={handleFormClose}
        systemId={system.id}
        mapping={editingMapping}
      />
    </div>
  )
}
