import { useState } from 'react'
import { Server, ChevronDown, ChevronUp, Plus, Pencil, Trash2, ArrowUp, ArrowDown, Loader2 } from 'lucide-react'
import {
  useEquipment,
  useDeleteEquipment,
  useReorderEquipment,
} from '@/hooks/useEquipment'
import { EquipmentForm } from './EquipmentForm'
import type { Equipment } from '@/types/export'

interface EquipmentPanelProps {
  projectId: number
  layerId: number
  isReadOnly: boolean
}

export function EquipmentPanel({ projectId, layerId, isReadOnly }: EquipmentPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Equipment | null>(null)

  const { data: equipmentList = [], isLoading } = useEquipment(projectId, layerId)
  const deleteEquipment = useDeleteEquipment(projectId, layerId)
  const reorderEquipment = useReorderEquipment(projectId, layerId)

  const handleAdd = () => {
    setEditTarget(null)
    setFormOpen(true)
  }

  const handleEdit = (eq: Equipment) => {
    setEditTarget(eq)
    setFormOpen(true)
  }

  const handleDelete = (eq: Equipment) => {
    const confirmed = window.confirm(`설비 '${eq.equipment_id}'를 삭제하시겠습니까?`)
    if (!confirmed) return
    deleteEquipment.mutate(eq.id)
  }

  const handleMoveUp = (index: number) => {
    if (index === 0) return
    const orderedIds = equipmentList.map((eq) => eq.id)
    const temp = orderedIds[index - 1]
    orderedIds[index - 1] = orderedIds[index]
    orderedIds[index] = temp
    reorderEquipment.mutate(orderedIds)
  }

  const handleMoveDown = (index: number) => {
    if (index === equipmentList.length - 1) return
    const orderedIds = equipmentList.map((eq) => eq.id)
    const temp = orderedIds[index + 1]
    orderedIds[index + 1] = orderedIds[index]
    orderedIds[index] = temp
    reorderEquipment.mutate(orderedIds)
  }

  const handleFormClose = () => {
    setFormOpen(false)
    setEditTarget(null)
  }

  return (
    <>
      <div className="border border-gray-200 rounded-lg mx-4 mb-2 bg-white shadow-sm shrink-0">
        {/* Panel header */}
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        >
          <Server className="h-4 w-4 text-gray-500 shrink-0" />
          <span className="text-sm font-medium text-gray-800 flex-1">설비 할당</span>
          {equipmentList.length > 0 && !isExpanded && (
            <span className="text-xs text-primary font-medium">
              {equipmentList.length}개
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </button>

        {/* Panel body */}
        {isExpanded && (
          <div className="px-4 pb-4 border-t border-gray-100">
            {/* Add button */}
            {!isReadOnly && (
              <div className="flex justify-end mt-3 mb-2">
                <button
                  type="button"
                  onClick={handleAdd}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary/90 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  설비 추가
                </button>
              </div>
            )}

            {/* Loading state */}
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">불러오는 중...</span>
              </div>
            ) : equipmentList.length === 0 ? (
              /* Empty state */
              <div className="py-6 text-center text-sm text-muted-foreground">
                할당된 설비가 없습니다
              </div>
            ) : (
              /* Equipment list */
              <ul className="space-y-1.5">
                {equipmentList.map((eq, index) => {
                  const paramCount = Object.keys(eq.equipment_params).length
                  return (
                    <li
                      key={eq.id}
                      className="flex items-center gap-2 px-3 py-2 rounded border border-gray-100 bg-gray-50 text-sm"
                    >
                      {/* Reorder buttons */}
                      {!isReadOnly && (
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleMoveUp(index)}
                            disabled={index === 0}
                            className="p-0.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="위로 이동"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveDown(index)}
                            disabled={index === equipmentList.length - 1}
                            className="p-0.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="아래로 이동"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                        </div>
                      )}

                      {/* Equipment info */}
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-800 truncate block">
                          {eq.equipment_id}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          파라미터 {paramCount}개 · 순서 {eq.sort_order}
                        </span>
                      </div>

                      {/* Action buttons */}
                      {!isReadOnly && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleEdit(eq)}
                            className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="수정"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(eq)}
                            className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Equipment form modal */}
      <EquipmentForm
        isOpen={formOpen}
        onClose={handleFormClose}
        projectId={projectId}
        layerId={layerId}
        equipment={editTarget}
      />
    </>
  )
}
