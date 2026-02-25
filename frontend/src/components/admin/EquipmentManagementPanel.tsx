import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EquipmentFormModal } from './EquipmentFormModal'
import {
  useAdminEquipments,
  useDeleteEquipment,
  useUpdateEquipment,
  useAdminLines,
} from '@/hooks/useAdminMaster'
import type { EquipmentResponse } from '@/api/adminMaster'

interface EquipmentManagementPanelProps {
  readOnly?: boolean
}

export function EquipmentManagementPanel({ readOnly = false }: EquipmentManagementPanelProps) {
  const [selectedLineId, setSelectedLineId] = useState<string>('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentResponse | null>(null)

  const { data: lines = [] } = useAdminLines()
  const { data: equipments = [], isLoading } = useAdminEquipments(
    selectedLineId ? parseInt(selectedLineId) : undefined
  )
  const deleteMutation = useDeleteEquipment()
  const updateMutation = useUpdateEquipment()

  const handleAdd = () => {
    setSelectedEquipment(null)
    setIsFormOpen(true)
  }

  const handleEdit = (equipment: EquipmentResponse) => {
    setSelectedEquipment(equipment)
    setIsFormOpen(true)
  }

  const handleDelete = async (equipment: EquipmentResponse) => {
    if (!confirm(`'${equipment.equipment_name}' 설비를 삭제하시겠습니까?`)) return
    try {
      await deleteMutation.mutateAsync(equipment.id)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      alert(axiosErr.response?.data?.detail ?? '삭제 중 오류가 발생했습니다.')
    }
  }

  const handleToggleActive = async (equipment: EquipmentResponse) => {
    try {
      await updateMutation.mutateAsync({
        id: equipment.id,
        payload: { is_active: !equipment.is_active },
      })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      alert(axiosErr.response?.data?.detail ?? '상태 변경 중 오류가 발생했습니다.')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="font-medium">설비 목록</h2>
          <select
            className="border border-input rounded-md px-3 py-1.5 text-sm bg-background"
            value={selectedLineId}
            onChange={(e) => setSelectedLineId(e.target.value)}
          >
            <option value="">전체 라인</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id.toString()}>{l.line_name}</option>
            ))}
          </select>
        </div>
        {!readOnly && (
          <Button size="sm" onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-1" />
            설비 추가
          </Button>
        )}
        {readOnly && <span className="text-xs text-muted-foreground">읽기 전용</span>}
      </div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">설비명</th>
              <th className="px-4 py-3 text-left font-medium">모델</th>
              <th className="px-4 py-3 text-left font-medium">라인</th>
              <th className="px-4 py-3 text-left font-medium">PRC</th>
              <th className="px-4 py-3 text-left font-medium">IP</th>
              <th className="px-4 py-3 text-left font-medium">FTP ID</th>
              <th className="px-4 py-3 text-center font-medium">상태</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  로딩 중...
                </td>
              </tr>
            )}
            {!isLoading && equipments.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  설비가 없습니다.
                </td>
              </tr>
            )}
            {equipments.map((eq) => (
              <tr key={eq.id} className="border-t hover:bg-muted/50">
                <td className="px-4 py-3 font-medium">{eq.equipment_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{eq.equipment_model ?? '-'}</td>
                <td className="px-4 py-3 text-muted-foreground">{eq.line_name}</td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{eq.prc ?? '-'}</td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{eq.ip ?? '-'}</td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{eq.ftp_id ?? '-'}</td>
                <td className="px-4 py-3 text-center">
                  {readOnly ? (
                    <Badge
                      className={
                        eq.is_active
                          ? 'bg-green-100 text-green-800 border-transparent'
                          : 'bg-red-100 text-red-800 border-transparent'
                      }
                    >
                      {eq.is_active ? '활성' : '비활성'}
                    </Badge>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleToggleActive(eq)}
                      className="cursor-pointer"
                      title={eq.is_active ? '비활성화 클릭' : '활성화 클릭'}
                    >
                      <Badge
                        className={
                          eq.is_active
                            ? 'bg-green-100 text-green-800 border-transparent'
                            : 'bg-red-100 text-red-800 border-transparent'
                        }
                      >
                        {eq.is_active ? '활성' : '비활성'}
                      </Badge>
                    </button>
                  )}
                </td>
                <td className="px-4 py-3">
                  {!readOnly && (
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(eq)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => handleDelete(eq)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <EquipmentFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        equipment={selectedEquipment}
        lineId={selectedLineId ? parseInt(selectedLineId) : undefined}
      />
    </div>
  )
}
