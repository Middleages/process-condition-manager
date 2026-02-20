import { useState, useEffect } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { useCreateEquipment, useUpdateEquipment } from '@/hooks/useEquipment'
import type { Equipment } from '@/types/export'

interface KeyValueRow {
  key: string
  value: string
}

interface EquipmentFormProps {
  isOpen: boolean
  onClose: () => void
  projectId: number
  layerId: number
  equipment?: Equipment | null
}

export function EquipmentForm({
  isOpen,
  onClose,
  projectId,
  layerId,
  equipment,
}: EquipmentFormProps) {
  const isEditMode = !!equipment

  const [equipmentId, setEquipmentId] = useState('')
  const [params, setParams] = useState<KeyValueRow[]>([])
  const [equipmentIdError, setEquipmentIdError] = useState('')

  const createEquipment = useCreateEquipment(projectId, layerId)
  const updateEquipment = useUpdateEquipment(projectId, layerId)

  // Initialize form when equipment prop changes or modal opens
  useEffect(() => {
    if (!isOpen) return

    if (equipment) {
      setEquipmentId(equipment.equipment_id)
      const rows: KeyValueRow[] = Object.entries(equipment.equipment_params).map(
        ([key, value]) => ({ key, value })
      )
      setParams(rows)
    } else {
      setEquipmentId('')
      setParams([])
    }
    setEquipmentIdError('')
  }, [isOpen, equipment])

  if (!isOpen) return null

  // Dynamic key-value editor handlers
  const addParam = () => {
    setParams((prev) => [...prev, { key: '', value: '' }])
  }

  const updateParam = (index: number, field: 'key' | 'value', val: string) => {
    setParams((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: val }
      return updated
    })
  }

  const removeParam = (index: number) => {
    setParams((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = () => {
    // Validate equipment_id
    if (!equipmentId.trim()) {
      setEquipmentIdError('설비 ID를 입력하세요.')
      return
    }
    setEquipmentIdError('')

    // Convert params rows to Record<string, string>
    const paramsRecord: Record<string, string> = {}
    params.forEach((p) => {
      if (p.key.trim()) {
        paramsRecord[p.key.trim()] = p.value
      }
    })

    const payload = {
      equipment_id: equipmentId.trim(),
      equipment_params: paramsRecord,
    }

    if (isEditMode && equipment) {
      updateEquipment.mutate(
        { eqId: equipment.id, payload },
        {
          onSuccess: () => {
            onClose()
          },
        }
      )
    } else {
      createEquipment.mutate(payload, {
        onSuccess: () => {
          onClose()
        },
      })
    }
  }

  const isPending = createEquipment.isPending || updateEquipment.isPending

  return (
    /* Modal overlay */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[90vh]">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-base font-semibold text-gray-800">
            {isEditMode ? '설비 수정' : '설비 추가'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="p-1 rounded text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Equipment ID field */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              설비 ID
              <span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              type="text"
              value={equipmentId}
              onChange={(e) => {
                setEquipmentId(e.target.value)
                if (e.target.value.trim()) setEquipmentIdError('')
              }}
              placeholder="예: SCANNER-01"
              className={`w-full px-3 py-2 text-sm border rounded-md outline-none transition-colors focus:ring-2 focus:ring-primary/30 ${
                equipmentIdError
                  ? 'border-red-400 focus:border-red-400'
                  : 'border-gray-300 focus:border-primary'
              }`}
              disabled={isPending}
            />
            {equipmentIdError && (
              <p className="mt-1 text-xs text-red-500">{equipmentIdError}</p>
            )}
          </div>

          {/* Parameters section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">파라미터</label>
              <button
                type="button"
                onClick={addParam}
                disabled={isPending}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                파라미터 추가
              </button>
            </div>

            {params.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                파라미터가 없습니다. '파라미터 추가' 버튼을 눌러 추가하세요.
              </p>
            ) : (
              <ul className="space-y-2">
                {params.map((row, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.key}
                      onChange={(e) => updateParam(index, 'key', e.target.value)}
                      placeholder="키"
                      className="flex-1 px-2.5 py-1.5 text-sm border border-gray-300 rounded-md outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
                      disabled={isPending}
                    />
                    <span className="text-gray-400 text-sm shrink-0">:</span>
                    <input
                      type="text"
                      value={row.value}
                      onChange={(e) => updateParam(index, 'value', e.target.value)}
                      placeholder="값"
                      className="flex-1 px-2.5 py-1.5 text-sm border border-gray-300 rounded-md outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
                      disabled={isPending}
                    />
                    <button
                      type="button"
                      onClick={() => removeParam(index)}
                      disabled={isPending}
                      className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50 shrink-0"
                      title="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
