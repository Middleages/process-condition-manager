import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useCreateDeviceMetaSource,
  useUpdateDeviceMetaSource,
  useDiscoverColumns,
} from '@/hooks/useDeviceMaster'
import type {
  DeviceMetaSource,
  DeviceMetaSourceCreate,
  JoinKey,
  MetaColumnMapping,
} from '@/types/deviceMaster'
import { Plus, Trash2, Search, Loader2 } from 'lucide-react'

interface DeviceMetaSourceFormModalProps {
  source?: DeviceMetaSource | null
  open: boolean
  onClose: () => void
  onSave: () => void
}

const DEVICE_FIELD_OPTIONS = [
  { value: 'product_name', label: 'product_name' },
  { value: 'process', label: 'process' },
  { value: 'part_id', label: 'part_id' },
  { value: 'line_id', label: 'line_id' },
]

const SELECT_CLASS = 'w-full border border-input bg-background px-3 py-2 rounded-md text-sm'

export function DeviceMetaSourceFormModal({
  source,
  open,
  onClose,
  onSave,
}: DeviceMetaSourceFormModalProps) {
  const isEdit = !!source

  const createMutation = useCreateDeviceMetaSource()
  const updateMutation = useUpdateDeviceMetaSource()

  const [sourceName, setSourceName] = useState('')
  const [tableName, setTableName] = useState('')
  const [schemaName, setSchemaName] = useState('public')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [joinKeys, setJoinKeys] = useState<JoinKey[]>([
    { device_field: 'product_name', source_column: '' },
  ])
  const [columnMappings, setColumnMappings] = useState<MetaColumnMapping[]>([
    { source_column: '', target_field: '' },
  ])
  const [serverError, setServerError] = useState<string | null>(null)

  // Column discovery state
  const [discoverTableName, setDiscoverTableName] = useState<string | null>(null)
  const [discoverSchemaName, setDiscoverSchemaName] = useState('public')
  const {
    data: discoveredColumns = [],
    isLoading: isDiscovering,
  } = useDiscoverColumns(discoverTableName, discoverSchemaName)

  // Populate form on open
  useEffect(() => {
    if (source) {
      setSourceName(source.source_name)
      setTableName(source.table_name)
      setSchemaName(source.schema_name || 'public')
      setDescription(source.description ?? '')
      setIsActive(source.is_active)
      setJoinKeys(
        source.join_keys.length > 0
          ? source.join_keys
          : [{ device_field: 'product_name', source_column: '' }]
      )
      setColumnMappings(
        source.column_mappings.length > 0
          ? source.column_mappings
          : [{ source_column: '', target_field: '' }]
      )
    } else {
      setSourceName('')
      setTableName('')
      setSchemaName('public')
      setDescription('')
      setIsActive(true)
      setJoinKeys([{ device_field: 'product_name', source_column: '' }])
      setColumnMappings([{ source_column: '', target_field: '' }])
    }
    setServerError(null)
    setDiscoverTableName(null)
  }, [source, open])

  const handleDiscover = () => {
    if (!tableName.trim()) return
    setDiscoverSchemaName(schemaName.trim() || 'public')
    setDiscoverTableName(tableName.trim())
  }

  // Join key helpers
  const addJoinKey = () =>
    setJoinKeys((prev) => [...prev, { device_field: 'product_name', source_column: '' }])
  const removeJoinKey = (index: number) =>
    setJoinKeys((prev) => prev.filter((_, i) => i !== index))
  const updateJoinKey = (index: number, field: keyof JoinKey, value: string) =>
    setJoinKeys((prev) =>
      prev.map((jk, i) => (i === index ? { ...jk, [field]: value } : jk))
    )

  // Column mapping helpers
  const addColumnMapping = () =>
    setColumnMappings((prev) => [...prev, { source_column: '', target_field: '' }])
  const removeColumnMapping = (index: number) =>
    setColumnMappings((prev) => prev.filter((_, i) => i !== index))
  const updateColumnMapping = (
    index: number,
    field: keyof MetaColumnMapping,
    value: string
  ) =>
    setColumnMappings((prev) =>
      prev.map((cm, i) => (i === index ? { ...cm, [field]: value } : cm))
    )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setServerError(null)

    const validJoinKeys = joinKeys.filter((jk) => jk.source_column.trim())
    if (validJoinKeys.length === 0) {
      setServerError('최소 1개 이상의 JOIN 키를 입력해 주세요.')
      return
    }

    const validMappings = columnMappings.filter(
      (cm) => cm.source_column.trim() && cm.target_field.trim()
    )
    if (validMappings.length === 0) {
      setServerError('최소 1개 이상의 컬럼 매핑을 입력해 주세요.')
      return
    }

    const payload: DeviceMetaSourceCreate = {
      source_name: sourceName.trim(),
      table_name: tableName.trim(),
      schema_name: schemaName.trim() || 'public',
      join_keys: validJoinKeys,
      column_mappings: validMappings,
      description: description.trim() || undefined,
      is_active: isActive,
    }

    const onSuccess = () => {
      onSave()
      onClose()
    }
    const onError = () => {
      setServerError('저장 중 오류가 발생했습니다.')
    }

    if (isEdit && source) {
      updateMutation.mutate(
        { id: source.id, payload },
        { onSuccess, onError }
      )
    } else {
      createMutation.mutate(payload, { onSuccess, onError })
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  // Build discovered column options for dropdowns
  const columnOptions = discoveredColumns.map((col) => col.column_name)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? '메타 소스 수정' : '메타 소스 추가'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              placeholder="예: MES_DEVICE_META"
              maxLength={100}
              required
            />
          </div>

          {/* table_name + discover */}
          <div>
            <label className="block text-sm font-medium mb-1">
              테이블명 <span className="text-destructive">*</span>
            </label>
            <div className="flex gap-2">
              <Input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="예: mes_device_info"
                maxLength={200}
                required
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDiscover}
                disabled={isDiscovering || !tableName.trim()}
                className="whitespace-nowrap"
              >
                {isDiscovering ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Search className="h-4 w-4 mr-1" />
                )}
                컬럼 탐색
              </Button>
            </div>
            {discoveredColumns.length > 0 && (
              <div className="mt-2 border rounded-md p-2 bg-green-50 text-xs">
                <p className="font-medium text-green-700 mb-1">
                  {discoveredColumns.length}개 컬럼 발견
                </p>
                <div className="max-h-20 overflow-y-auto space-y-0.5">
                  {discoveredColumns.map((col) => (
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
          </div>

          {/* description */}
          <div>
            <label className="block text-sm font-medium mb-1">설명</label>
            <textarea
              className="w-full border border-input bg-background px-3 py-2 rounded-md text-sm resize-none"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="메타 소스 설명 (선택)"
            />
          </div>

          {/* join_keys */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">
                JOIN 키 <span className="text-destructive">*</span>
              </label>
              <Button type="button" variant="outline" size="sm" onClick={addJoinKey}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                키 추가
              </Button>
            </div>
            <div className="space-y-2">
              {joinKeys.map((jk, index) => (
                <div key={index} className="flex items-center gap-2">
                  <select
                    className={`${SELECT_CLASS} flex-1`}
                    value={jk.device_field}
                    onChange={(e) => updateJoinKey(index, 'device_field', e.target.value)}
                  >
                    {DEVICE_FIELD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted-foreground text-sm shrink-0">=</span>
                  {columnOptions.length > 0 ? (
                    <select
                      className={`${SELECT_CLASS} flex-1`}
                      value={jk.source_column}
                      onChange={(e) => updateJoinKey(index, 'source_column', e.target.value)}
                    >
                      <option value="">-- 소스 컬럼 선택 --</option>
                      {columnOptions.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={jk.source_column}
                      onChange={(e) => updateJoinKey(index, 'source_column', e.target.value)}
                      placeholder="소스 컬럼명"
                      className="flex-1"
                    />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
                    onClick={() => removeJoinKey(index)}
                    disabled={joinKeys.length === 1}
                    title="삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              디바이스 필드와 소스 테이블의 JOIN 컬럼을 매핑합니다.
            </p>
          </div>

          {/* column_mappings */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">
                컬럼 매핑 <span className="text-destructive">*</span>
              </label>
              <Button type="button" variant="outline" size="sm" onClick={addColumnMapping}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                매핑 추가
              </Button>
            </div>
            <div className="space-y-2">
              {columnMappings.map((cm, index) => (
                <div key={index} className="flex items-center gap-2">
                  {columnOptions.length > 0 ? (
                    <select
                      className={`${SELECT_CLASS} flex-1`}
                      value={cm.source_column}
                      onChange={(e) =>
                        updateColumnMapping(index, 'source_column', e.target.value)
                      }
                    >
                      <option value="">-- 소스 컬럼 --</option>
                      {columnOptions.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={cm.source_column}
                      onChange={(e) =>
                        updateColumnMapping(index, 'source_column', e.target.value)
                      }
                      placeholder="소스 컬럼"
                      className="flex-1"
                    />
                  )}
                  <span className="text-muted-foreground text-sm shrink-0">-&gt;</span>
                  <Input
                    value={cm.target_field}
                    onChange={(e) =>
                      updateColumnMapping(index, 'target_field', e.target.value)
                    }
                    placeholder="타겟 필드 (enrichment key)"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
                    onClick={() => removeColumnMapping(index)}
                    disabled={columnMappings.length === 1}
                    title="삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              소스 컬럼 값을 enrichment의 타겟 필드로 매핑합니다.
            </p>
          </div>

          {/* is_active */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="meta-source-is-active"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="meta-source-is-active" className="text-sm">
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
