import { useEffect, useState } from 'react'
import { useCreateMapping, useUpdateMapping } from '@/hooks/useAdminMappings'
import { useColumns } from '@/hooks/useColumns'
import type { XmlMapping } from '@/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface MappingFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mapping?: XmlMapping
}

const TRANSFORM_OPTIONS = [
  { value: '', label: '(없음)' },
  { value: 'to_int', label: 'to_int' },
  { value: 'to_float', label: 'to_float' },
  { value: 'yn_to_bool', label: 'yn_to_bool' },
]

export function MappingFormModal({ open, onOpenChange, mapping }: MappingFormModalProps) {
  const isEdit = !!mapping
  const { data: categories = [] } = useColumns()
  const createMutation = useCreateMapping()
  const updateMutation = useUpdateMapping()

  const [xpath, setXpath] = useState('')
  const [columnId, setColumnId] = useState<number | null>(null)
  const [valueTransform, setValueTransform] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Populate form when editing
  useEffect(() => {
    if (mapping) {
      setXpath(mapping.xpath)
      setColumnId(mapping.column_id)
      setValueTransform(mapping.value_transform || '')
      setIsActive(mapping.is_active)
    } else {
      setXpath('')
      setColumnId(null)
      setValueTransform('')
      setIsActive(true)
    }
  }, [mapping])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!columnId) {
      alert('대상 컬럼을 선택해주세요.')
      return
    }

    if (isEdit && mapping) {
      updateMutation.mutate(
        {
          id: mapping.id,
          request: {
            xpath,
            column_id: columnId,
            value_transform: valueTransform || null,
            is_active: isActive,
          },
        },
        {
          onSuccess: () => onOpenChange(false),
        }
      )
    } else {
      createMutation.mutate(
        {
          xpath,
          column_id: columnId,
          value_transform: valueTransform || null,
        },
        {
          onSuccess: () => onOpenChange(false),
        }
      )
    }
  }

  // Build column options grouped by category
  const columnOptions = categories.flatMap((cat) =>
    cat.columns.map((col) => ({
      value: col.id,
      label: `${col.column_name} - ${col.display_name} (${cat.category_code})`,
      category: cat.category_code,
    }))
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'XML 매핑 수정' : 'XML 매핑 추가'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* XPath */}
          <div>
            <label className="block text-sm font-medium mb-1">
              XPath <span className="text-destructive">*</span>
            </label>
            <Input
              value={xpath}
              onChange={(e) => setXpath(e.target.value)}
              placeholder="/recipe/step[@id='123']/param"
              maxLength={300}
              required
            />
          </div>

          {/* Target Column */}
          <div>
            <label className="block text-sm font-medium mb-1">
              대상 컬럼 <span className="text-destructive">*</span>
            </label>
            <select
              className="w-full border border-input bg-background px-3 py-2 rounded-md text-sm"
              value={columnId ?? ''}
              onChange={(e) => setColumnId(e.target.value ? Number(e.target.value) : null)}
              required
            >
              <option value="">컬럼 선택</option>
              {columnOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Value Transform */}
          <div>
            <label className="block text-sm font-medium mb-1">값 변환</label>
            <select
              className="w-full border border-input bg-background px-3 py-2 rounded-md text-sm"
              value={valueTransform}
              onChange={(e) => setValueTransform(e.target.value)}
            >
              {TRANSFORM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Active (edit only) */}
          {isEdit && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is-active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="is-active" className="text-sm">
                활성
              </label>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              {isEdit ? '수정' : '생성'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
