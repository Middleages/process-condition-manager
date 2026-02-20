// ExportMappingForm.tsx
// Modal form for creating or editing a column mapping within an export system.
// Supports two source types:
//   - condition: maps a PCM condition table column (existing behavior)
//   - external: maps a column from an external data source (new)

import { useEffect, useState } from 'react'
import { useColumns } from '@/hooks/useColumns'
import { useCreateExportMapping, useUpdateExportMapping } from '@/hooks/useExportAdmin'
import { useExportDataSources, useDataSourceColumns } from '@/hooks/useExportDataSources'
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

  // Data hooks
  const { data: categories = [] } = useColumns()
  const { data: dataSources = [] } = useExportDataSources()
  const createMutation = useCreateExportMapping(systemId)
  const updateMutation = useUpdateExportMapping(systemId)

  // Form state
  const [sourceType, setSourceType] = useState<'condition' | 'external'>('condition')
  const [columnId, setColumnId] = useState<number | ''>('')
  const [dataSourceId, setDataSourceId] = useState<number | ''>('')
  const [sourceColumnName, setSourceColumnName] = useState('')
  const [targetColumnName, setTargetColumnName] = useState('')
  const [isRequired, setIsRequired] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Dynamic column list for selected external data source
  const { data: externalColumns = [] } = useDataSourceColumns(
    sourceType === 'external' && dataSourceId !== '' ? (dataSourceId as number) : null
  )

  // Populate form when editing or reset when adding
  useEffect(() => {
    if (mapping) {
      setSourceType(mapping.source_type ?? 'condition')
      setColumnId(mapping.column_id != null ? mapping.column_id : '')
      setDataSourceId(mapping.data_source_id != null ? mapping.data_source_id : '')
      setSourceColumnName(mapping.source_column_name ?? '')
      setTargetColumnName(mapping.target_column_name)
      setIsRequired(mapping.is_required)
    } else {
      setSourceType('condition')
      setColumnId('')
      setDataSourceId('')
      setSourceColumnName('')
      setTargetColumnName('')
      setIsRequired(false)
    }
    setServerError(null)
  }, [mapping, isOpen])

  // Reset source-specific fields when switching source type
  const handleSourceTypeChange = (type: 'condition' | 'external') => {
    setSourceType(type)
    setColumnId('')
    setDataSourceId('')
    setSourceColumnName('')
    setServerError(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setServerError(null)

    // Validation per source type
    if (sourceType === 'condition') {
      if (columnId === '') {
        setServerError('컬럼을 선택해 주세요.')
        return
      }
    } else {
      if (dataSourceId === '') {
        setServerError('데이터 소스를 선택해 주세요.')
        return
      }
      if (!sourceColumnName.trim()) {
        setServerError('소스 컬럼을 선택해 주세요.')
        return
      }
    }

    // Build payload
    const payload =
      sourceType === 'condition'
        ? {
            source_type: 'condition' as const,
            column_id: columnId as number,
            target_column_name: targetColumnName.trim(),
            is_required: isRequired,
          }
        : {
            source_type: 'external' as const,
            data_source_id: dataSourceId as number,
            source_column_name: sourceColumnName,
            target_column_name: targetColumnName.trim(),
            is_required: isRequired,
          }

    const handleError = (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 409) {
        setServerError('이미 등록된 컬럼 매핑입니다.')
      } else {
        setServerError('저장 중 오류가 발생했습니다.')
      }
    }

    if (isEdit && mapping) {
      updateMutation.mutate(
        { mappingId: mapping.id, payload },
        { onSuccess: () => onClose(), onError: handleError }
      )
    } else {
      createMutation.mutate(payload, { onSuccess: () => onClose(), onError: handleError })
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  // Active (non-deleted) data sources only
  const activeDataSources = dataSources.filter((ds) => ds.is_active)

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

          {/* Source type toggle */}
          <div>
            <label className="block text-sm font-medium mb-2">소스 타입</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="source-type"
                  value="condition"
                  checked={sourceType === 'condition'}
                  onChange={() => handleSourceTypeChange('condition')}
                  className="h-4 w-4"
                />
                조건표 컬럼
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="source-type"
                  value="external"
                  checked={sourceType === 'external'}
                  onChange={() => handleSourceTypeChange('external')}
                  className="h-4 w-4"
                />
                외부 데이터 소스
              </label>
            </div>
          </div>

          {/* Condition: column selection grouped by category */}
          {sourceType === 'condition' && (
            <div>
              <label className="block text-sm font-medium mb-1">
                컬럼 <span className="text-destructive">*</span>
              </label>
              <select
                className={SELECT_CLASS}
                value={columnId === '' ? '' : String(columnId)}
                onChange={(e) =>
                  setColumnId(e.target.value === '' ? '' : Number(e.target.value))
                }
                required={sourceType === 'condition'}
              >
                <option value="">컬럼 선택</option>
                {(categories as ColumnCategory[]).map((cat) => (
                  <optgroup
                    key={cat.category_code}
                    label={`[${cat.category_code}] ${cat.category_name}`}
                  >
                    {cat.columns.map((col) => (
                      <option key={col.id} value={String(col.id)}>
                        [{cat.category_code}] {col.display_name} ({col.column_name})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          {/* External: data source + column selection */}
          {sourceType === 'external' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">
                  데이터 소스 <span className="text-destructive">*</span>
                </label>
                <select
                  className={SELECT_CLASS}
                  value={dataSourceId === '' ? '' : String(dataSourceId)}
                  onChange={(e) => {
                    setDataSourceId(e.target.value === '' ? '' : Number(e.target.value))
                    setSourceColumnName('')
                  }}
                  required={sourceType === 'external'}
                >
                  <option value="">데이터 소스 선택</option>
                  {activeDataSources.map((ds) => (
                    <option key={ds.id} value={String(ds.id)}>
                      {ds.source_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  소스 컬럼 <span className="text-destructive">*</span>
                </label>
                <select
                  className={SELECT_CLASS}
                  value={sourceColumnName}
                  onChange={(e) => setSourceColumnName(e.target.value)}
                  disabled={dataSourceId === '' || externalColumns.length === 0}
                  required={sourceType === 'external'}
                >
                  <option value="">
                    {dataSourceId === ''
                      ? '데이터 소스를 먼저 선택하세요'
                      : externalColumns.length === 0
                      ? '컬럼 로딩 중...'
                      : '소스 컬럼 선택'}
                  </option>
                  {externalColumns.map((col) => (
                    <option key={col.column_name} value={col.column_name}>
                      {col.column_name} ({col.data_type})
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

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
