// ExportDataSourceForm.tsx
// Modal form for creating or editing an external data source.
// Includes a "Verify Table" button that fetches column info from the backend.

import { useEffect, useState } from 'react'
import { useCreateDataSource, useUpdateDataSource } from '@/hooks/useExportDataSources'
import { fetchDataSourceColumns } from '@/api/exportDataSource'
import type { ExportDataSource, ExportDataSourceCreate, JoinKeyMapping } from '@/types/export'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2, CheckCircle, Loader2 } from 'lucide-react'

interface ExportDataSourceFormProps {
  isOpen: boolean
  onClose: () => void
  dataSource?: ExportDataSource | null
}

const PCM_FIELD_OPTIONS: { value: JoinKeyMapping['pcm_field']; label: string }[] = [
  { value: 'project.product_id', label: 'project.product_id — 공정 조건표 제품 ID' },
  { value: 'layer.step_seq', label: 'layer.step_seq — 레이어 Step Seq' },
  { value: 'layer.layer_name', label: 'layer.layer_name — 레이어명' },
  { value: 'layer.layer_number', label: 'layer.layer_number — 레이어 번호' },
]

const SELECT_CLASS = 'w-full border border-input bg-background px-3 py-2 rounded-md text-sm'

export function ExportDataSourceForm({
  isOpen,
  onClose,
  dataSource,
}: ExportDataSourceFormProps) {
  const isEdit = !!dataSource

  const createMutation = useCreateDataSource()
  const updateMutation = useUpdateDataSource()

  const [sourceName, setSourceName] = useState('')
  const [tableName, setTableName] = useState('')
  const [schemaName, setSchemaName] = useState('public')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [joinKeyMappings, setJoinKeyMappings] = useState<JoinKeyMapping[]>([
    { external_column: '', pcm_field: 'project.product_id' },
  ])

  // Table verification state
  const [verifiedColumns, setVerifiedColumns] = useState<{ column_name: string; data_type: string }[] | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  const [serverError, setServerError] = useState<string | null>(null)

  // Populate form when editing or reset when adding
  useEffect(() => {
    if (dataSource) {
      setSourceName(dataSource.source_name)
      setTableName(dataSource.table_name)
      setSchemaName(dataSource.schema_name || 'public')
      setDescription(dataSource.description ?? '')
      setIsActive(dataSource.is_active)
      setJoinKeyMappings(
        dataSource.join_key_mappings.length > 0
          ? dataSource.join_key_mappings
          : [{ external_column: '', pcm_field: 'project.product_id' }]
      )
    } else {
      setSourceName('')
      setTableName('')
      setSchemaName('public')
      setDescription('')
      setIsActive(true)
      setJoinKeyMappings([{ external_column: '', pcm_field: 'project.product_id' }])
    }
    setVerifiedColumns(null)
    setVerifyError(null)
    setServerError(null)
  }, [dataSource, isOpen])

  // Reset verification when table name changes
  useEffect(() => {
    setVerifiedColumns(null)
    setVerifyError(null)
  }, [tableName, schemaName])

  const handleVerifyTable = async () => {
    if (!tableName.trim()) {
      setVerifyError('테이블명을 입력해 주세요.')
      return
    }
    // For new sources without an id, we verify via a temporary save approach.
    // However the API requires an existing id for /columns. Instead, we inform
    // the user that verification happens on save, or rely on edit mode.
    // For edit mode, use the existing id.
    if (!isEdit || !dataSource) {
      setVerifyError('테이블 검증은 저장 후 수정 모드에서 사용할 수 있습니다. 저장 시 자동 검증됩니다.')
      return
    }

    setIsVerifying(true)
    setVerifyError(null)
    setVerifiedColumns(null)

    try {
      const columns = await fetchDataSourceColumns(dataSource.id)
      setVerifiedColumns(columns)
    } catch {
      setVerifyError('테이블을 찾을 수 없거나 접근할 수 없습니다.')
    } finally {
      setIsVerifying(false)
    }
  }

  const handleAddKeyMapping = () => {
    setJoinKeyMappings((prev) => [
      ...prev,
      { external_column: '', pcm_field: 'project.product_id' },
    ])
  }

  const handleRemoveKeyMapping = (index: number) => {
    setJoinKeyMappings((prev) => prev.filter((_, i) => i !== index))
  }

  const handleKeyMappingChange = (
    index: number,
    field: keyof JoinKeyMapping,
    value: string
  ) => {
    setJoinKeyMappings((prev) =>
      prev.map((mapping, i) =>
        i === index ? { ...mapping, [field]: value } : mapping
      )
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setServerError(null)

    // Validate join key mappings
    const validMappings = joinKeyMappings.filter((m) => m.external_column.trim())
    if (validMappings.length === 0) {
      setServerError('최소 1개 이상의 JOIN 키 매핑을 입력해 주세요.')
      return
    }
    for (const mapping of validMappings) {
      if (!mapping.external_column.trim()) {
        setServerError('모든 JOIN 키의 외부 컬럼명을 입력해 주세요.')
        return
      }
    }

    const payload: ExportDataSourceCreate = {
      source_name: sourceName.trim(),
      table_name: tableName.trim(),
      schema_name: schemaName.trim() || 'public',
      description: description.trim() || undefined,
      join_key_mappings: validMappings,
      is_active: isActive,
    }

    if (isEdit && dataSource) {
      updateMutation.mutate(
        { id: dataSource.id, payload },
        {
          onSuccess: () => onClose(),
          onError: (err: unknown) => {
            const status = (err as { response?: { status?: number } })?.response?.status
            if (status === 409) {
              setServerError('같은 이름의 데이터 소스가 이미 존재합니다.')
            } else if (status === 404) {
              setServerError('테이블을 찾을 수 없습니다. 테이블명을 확인해 주세요.')
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
            setServerError('같은 이름의 데이터 소스가 이미 존재합니다.')
          } else if (status === 404) {
            setServerError('테이블을 찾을 수 없습니다. 테이블명을 확인해 주세요.')
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? '데이터 소스 수정' : '데이터 소스 추가'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Server-level error */}
          {serverError && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
              {serverError}
            </div>
          )}

          {/* source_name */}
          <div>
            <label className="block text-sm font-medium mb-1">
              소스 이름 <span className="text-destructive">*</span>
            </label>
            <Input
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="예: MES_LAYER_DATA"
              maxLength={100}
              required
            />
          </div>

          {/* table_name + Verify button */}
          <div>
            <label className="block text-sm font-medium mb-1">
              테이블명 <span className="text-destructive">*</span>
            </label>
            <div className="flex gap-2">
              <Input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="예: ext_mes_data"
                maxLength={200}
                required
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleVerifyTable}
                disabled={isVerifying || !tableName.trim()}
                className="whitespace-nowrap"
              >
                {isVerifying ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-1" />
                )}
                테이블 확인
              </Button>
            </div>

            {/* Verify error */}
            {verifyError && (
              <p className="mt-1 text-xs text-amber-600">{verifyError}</p>
            )}

            {/* Verified columns preview */}
            {verifiedColumns && verifiedColumns.length > 0 && (
              <div className="mt-2 border rounded-md p-2 bg-green-50 text-xs">
                <p className="font-medium text-green-700 mb-1">
                  컬럼 {verifiedColumns.length}개 확인됨
                </p>
                <div className="max-h-24 overflow-y-auto space-y-0.5">
                  {verifiedColumns.map((col) => (
                    <div key={col.column_name} className="flex justify-between text-green-600">
                      <span className="font-mono">{col.column_name}</span>
                      <span className="text-green-500 ml-2">{col.data_type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* schema_name */}
          <div>
            <label className="block text-sm font-medium mb-1">스키마명</label>
            <Input
              value={schemaName}
              onChange={(e) => setSchemaName(e.target.value)}
              placeholder="public"
              maxLength={50}
            />
            <p className="mt-1 text-xs text-muted-foreground">기본값: public</p>
          </div>

          {/* description */}
          <div>
            <label className="block text-sm font-medium mb-1">설명</label>
            <textarea
              className="w-full border border-input bg-background px-3 py-2 rounded-md text-sm resize-none"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="데이터 소스 설명 (선택)"
            />
          </div>

          {/* join_key_mappings */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">
                JOIN 키 매핑 <span className="text-destructive">*</span>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddKeyMapping}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                키 추가
              </Button>
            </div>
            <div className="space-y-2">
              {joinKeyMappings.map((mapping, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={mapping.external_column}
                    onChange={(e) =>
                      handleKeyMappingChange(index, 'external_column', e.target.value)
                    }
                    placeholder="외부 컬럼명 (예: product_id)"
                    className="flex-1"
                  />
                  <span className="text-muted-foreground text-sm shrink-0">↔</span>
                  <select
                    className={`${SELECT_CLASS} flex-1`}
                    value={mapping.pcm_field}
                    onChange={(e) =>
                      handleKeyMappingChange(
                        index,
                        'pcm_field',
                        e.target.value as JoinKeyMapping['pcm_field']
                      )
                    }
                  >
                    {PCM_FIELD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
                    onClick={() => handleRemoveKeyMapping(index)}
                    disabled={joinKeyMappings.length === 1}
                    title="삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              외부 테이블의 컬럼명과 PCM 필드를 매핑합니다.
            </p>
          </div>

          {/* is_active */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="data-source-is-active"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="data-source-is-active" className="text-sm">
              활성
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              취소
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
