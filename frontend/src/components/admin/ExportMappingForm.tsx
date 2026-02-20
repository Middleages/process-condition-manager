// ExportMappingForm.tsx
// Modal form for creating or editing a column mapping within an export system.
// Columns are grouped by category in the dropdown.

import { useEffect, useState } from 'react'
import { useColumns } from '@/hooks/useColumns'
import { useCreateExportMapping, useUpdateExportMapping } from '@/hooks/useExportAdmin'
import type { ExportMapping } from '@/types/export'
import type { ColumnCategory } from '@/types/column'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ExportMappingFormProps {
  isOpen: boolean
  onClose: () => void
  systemId: number
  mapping: ExportMapping | null
}

const SELECT_CLASS = 'w-full border border-input bg-background px-3 py-2 rounded-md text-sm'

export function ExportMappingForm({ isOpen, onClose, systemId, mapping }: ExportMappingFormProps) {
  const isEdit = !!mapping

  const { data: categories = [] } = useColumns()
  const createMutation = useCreateExportMapping(systemId)
  const updateMutation = useUpdateExportMapping(systemId)

  const [columnId, setColumnId] = useState<number | ''>('')
  const [targetColumnName, setTargetColumnName] = useState('')
  const [isRequired, setIsRequired] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Populate form when editing or reset when adding
  useEffect(() => {
    if (mapping) {
      setColumnId(mapping.column_id)
      setTargetColumnName(mapping.target_column_name)
      setIsRequired(mapping.is_required)
    } else {
      setColumnId('')
      setTargetColumnName('')
      setIsRequired(false)
    }
    setServerError(null)
  }, [mapping, isOpen])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setServerError(null)

    if (columnId === '') {
      setServerError('컬럼을 선택해 주세요.')
      return
    }

    const payload = {
      column_id: columnId as number,
      target_column_name: targetColumnName.trim(),
      is_required: isRequired,
    }

    if (isEdit && mapping) {
      updateMutation.mutate(
        { mappingId: mapping.id, payload },
        {
          onSuccess: () => onClose(),
          onError: (err: unknown) => {
            const status = (err as { response?: { status?: number } })?.response?.status
            if (status === 409) {
              setServerError('이미 등록된 컬럼 매핑입니다.')
            } else {
              setServerError('저장 중 오류가 발생했습니다.')
            }
          },
        }
      )
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => onClose(),
        onError: (err: unknown) => {
          const status = (err as { response?: { status?: number } })?.response?.status
          if (status === 409) {
            setServerError('이미 등록된 컬럼 매핑입니다.')
          } else {
            setServerError('저장 중 오류가 발생했습니다.')
          }
        },
      })
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? '매핑 수정' : '매핑 추가'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Server-level error */}
          {serverError && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
              {serverError}
            </div>
          )}

          {/* Column selection grouped by category */}
          <div>
            <label className="block text-sm font-medium mb-1">
              컬럼 <span className="text-destructive">*</span>
            </label>
            <select
              className={SELECT_CLASS}
              value={columnId === '' ? '' : String(columnId)}
              onChange={(e) => setColumnId(e.target.value === '' ? '' : Number(e.target.value))}
              required
            >
              <option value="">컬럼 선택</option>
              {(categories as ColumnCategory[]).map((cat) => (
                <optgroup key={cat.category_code} label={`[${cat.category_code}] ${cat.category_name}`}>
                  {cat.columns.map((col) => (
                    <option key={col.id} value={String(col.id)}>
                      [{cat.category_code}] {col.display_name} ({col.column_name})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Target column name */}
          <div>
            <label className="block text-sm font-medium mb-1">
              출력 컬럼명 <span className="text-destructive">*</span>
            </label>
            <Input
              value={targetColumnName}
              onChange={(e) => setTargetColumnName(e.target.value)}
              placeholder="예: Recipe_CD"
              maxLength={200}
              required
            />
          </div>

          {/* Is required */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="export-mapping-is-required"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="export-mapping-is-required" className="text-sm">
              필수
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              닫기
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
