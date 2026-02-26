import { useState, useMemo } from 'react'
import { useAuthStore } from '@/stores/useAuthStore'
import { useToastStore } from '@/stores/useToastStore'
import { canWrite } from '@/lib/permissions'
import type { UserRole } from '@/types/user'
import { useLines } from '@/hooks/useLines'
import {
  useDeviceMasters,
  useSyncDeviceMasters,
  useEnrichAllDevices,
  useDeviceMetaSources,
  useDeleteDeviceMetaSource,
  useSyncSourceConfigs,
  useCreateSyncSourceConfig,
  useUpdateSyncSourceConfig,
  useDeleteSyncSourceConfig,
} from '@/hooks/useDeviceMaster'
import type {
  DeviceMaster,
  DeviceMetaSource,
  SyncSourceConfig,
  SyncSourceConfigCreate,
} from '@/types/deviceMaster'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { DeviceDetailModal } from '@/components/admin/DeviceDetailModal'
import { DeviceMetaSourceFormModal } from '@/components/admin/DeviceMetaSourceFormModal'
import { useConfirm } from '@/hooks/useConfirm'
import {
  RefreshCw,
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
} from 'lucide-react'

type SubTab = 'devices' | 'meta-sources' | 'sync-configs'

export default function DeviceMasterPage() {
  const [subTab, setSubTab] = useState<SubTab>('devices')

  const userRoles = useAuthStore((s) => s.user?.roles) as UserRole[] | undefined
  const readOnly = !canWrite(userRoles, 'system_config')

  return (
    <div className="p-6 space-y-4">
      {/* Sub-tab Navigation */}
      <div className="flex gap-1 border-b border-border">
        {[
          { key: 'devices' as SubTab, label: '디바이스 목록' },
          { key: 'meta-sources' as SubTab, label: '메타 소스' },
          { key: 'sync-configs' as SubTab, label: '동기화 설정' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setSubTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              subTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'devices' && <DeviceListPanel readOnly={readOnly} />}
      {subTab === 'meta-sources' && <MetaSourcesPanel readOnly={readOnly} />}
      {subTab === 'sync-configs' && <SyncConfigsPanel readOnly={readOnly} />}
    </div>
  )
}

// ========== Device List Panel ==========

function DeviceListPanel({ readOnly }: { readOnly: boolean }) {
  const addToast = useToastStore((s) => s.addToast)

  const [page, setPage] = useState(1)
  const [lineId, setLineId] = useState<number | undefined>(undefined)
  const [productSearch, setProductSearch] = useState('')
  const [debouncedProductSearch, setDebouncedProductSearch] = useState('')
  const [selectedDevice, setSelectedDevice] = useState<DeviceMaster | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const { data: lines = [] } = useLines()

  // Debounce product name search
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const handleProductSearchChange = (value: string) => {
    setProductSearch(value)
    if (searchTimer) clearTimeout(searchTimer)
    const timer = setTimeout(() => {
      setDebouncedProductSearch(value)
      setPage(1)
    }, 400)
    setSearchTimer(timer)
  }

  const queryParams = useMemo(
    () => ({
      page,
      size: 20,
      line_id: lineId,
      product_name: debouncedProductSearch || undefined,
    }),
    [page, lineId, debouncedProductSearch]
  )

  const { data, isLoading } = useDeviceMasters(queryParams)
  const syncMutation = useSyncDeviceMasters()
  const enrichAllMutation = useEnrichAllDevices()

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / 20)

  const handleSync = () => {
    syncMutation.mutate(true, {
      onSuccess: (result) => {
        addToast(
          `동기화 완료: ${result.inserted}개 추가, ${result.updated}개 수정, ${result.unchanged}개 변경없음` +
            (result.errors.length > 0 ? ` (오류 ${result.errors.length}건)` : ''),
          result.errors.length > 0 ? 'info' : 'success'
        )
      },
      onError: () => {
        addToast('디바이스 동기화 중 오류가 발생했습니다.', 'error')
      },
    })
  }

  const handleEnrichAll = () => {
    enrichAllMutation.mutate(undefined, {
      onSuccess: (result) => {
        addToast(
          `전체 Enrichment 완료: ${result.devices_enriched}대 처리` +
            (result.total_errors > 0 ? `, ${result.total_errors}건 오류` : ''),
          result.total_errors > 0 ? 'info' : 'success'
        )
      },
      onError: () => {
        addToast('전체 Enrichment 중 오류가 발생했습니다.', 'error')
      },
    })
  }

  const handleRowClick = (device: DeviceMaster) => {
    setSelectedDevice(device)
    setDetailOpen(true)
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">디바이스 마스터</h2>
        {!readOnly && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleEnrichAll}
              disabled={enrichAllMutation.isPending}
            >
              {enrichAllMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              전체 Enrich
            </Button>
            <Button
              size="sm"
              onClick={handleSync}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              디바이스 동기화
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <select
          className="border border-input bg-background px-3 py-2 rounded-md text-sm"
          value={lineId ?? ''}
          onChange={(e) => {
            setLineId(e.target.value ? Number(e.target.value) : undefined)
            setPage(1)
          }}
        >
          <option value="">전체 라인</option>
          {lines.map((line) => (
            <option key={line.id} value={line.id}>
              {line.line_name}
            </option>
          ))}
        </select>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={productSearch}
            onChange={(e) => handleProductSearchChange(e.target.value)}
            placeholder="제품명 검색..."
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground ml-auto">
          총 {total}건
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          디바이스 데이터가 없습니다. 동기화를 실행해 주세요.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">라인</th>
                <th className="px-4 py-3 text-left text-sm font-medium">제품명</th>
                <th className="px-4 py-3 text-left text-sm font-medium">공정</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Part ID</th>
                <th className="px-4 py-3 text-left text-sm font-medium">상태</th>
                <th className="px-4 py-3 text-left text-sm font-medium">동기화일시</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((device) => (
                <tr
                  key={device.id}
                  className={`hover:bg-muted/50 cursor-pointer ${
                    !device.is_active ? 'opacity-50 bg-muted/20' : ''
                  }`}
                  onClick={() => handleRowClick(device)}
                >
                  <td className="px-4 py-3 text-sm">{device.line_name}</td>
                  <td className="px-4 py-3 text-sm font-medium">{device.product_name}</td>
                  <td className="px-4 py-3 text-sm">{device.process}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {device.part_id ?? '--'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {device.is_active ? (
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
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {device.synced_at
                      ? new Date(device.synced_at).toLocaleString('ko-KR')
                      : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Detail Modal */}
      <DeviceDetailModal
        device={selectedDevice}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        readOnly={readOnly}
      />
    </>
  )
}

// ========== Meta Sources Panel ==========

function MetaSourcesPanel({ readOnly }: { readOnly: boolean }) {
  const [selectedSource, setSelectedSource] = useState<DeviceMetaSource | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const { data: sources = [], isLoading } = useDeviceMetaSources()
  const deleteMutation = useDeleteDeviceMetaSource()

  const { confirm: confirmDelete, ConfirmDialogElement: DeleteDialog } = useConfirm({
    title: '메타 소스 삭제',
    description: '메타 소스를 삭제하시겠습니까?',
    confirmText: '삭제',
    variant: 'destructive',
  })

  const handleAdd = () => {
    setSelectedSource(null)
    setIsEditing(false)
    setIsFormOpen(true)
  }

  const handleEdit = (source: DeviceMetaSource) => {
    setSelectedSource(source)
    setIsEditing(true)
    setIsFormOpen(true)
  }

  const handleDelete = async (source: DeviceMetaSource) => {
    if (await confirmDelete()) {
      deleteMutation.mutate(source.id)
    }
  }

  const handleFormClose = () => {
    setIsFormOpen(false)
    if (!isEditing) setSelectedSource(null)
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">디바이스 메타 소스</h2>
        {!readOnly ? (
          <Button size="sm" onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-1" />
            메타 소스 추가
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">읽기 전용</span>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        디바이스 Enrichment 시 외부 테이블에서 메타 데이터를 가져오는 소스를 관리합니다.
      </p>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      ) : sources.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          등록된 메타 소스가 없습니다.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">소스 이름</th>
                <th className="px-4 py-3 text-left text-sm font-medium">테이블명</th>
                <th className="px-4 py-3 text-left text-sm font-medium">스키마</th>
                <th className="px-4 py-3 text-left text-sm font-medium">상태</th>
                <th className="px-4 py-3 text-left text-sm font-medium">매핑 수</th>
                <th className="px-4 py-3 text-right text-sm font-medium">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sources.map((source) => (
                <tr
                  key={source.id}
                  className={`hover:bg-muted/50 ${
                    !source.is_active ? 'opacity-50 bg-muted/20' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-sm font-medium">{source.source_name}</td>
                  <td className="px-4 py-3 text-sm font-mono text-xs">{source.table_name}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {source.schema_name}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {source.is_active ? (
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
                    <Badge variant="outline">
                      {source.join_keys.length + source.column_mappings.length}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-right space-x-1">
                    {!readOnly && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="수정"
                          onClick={() => handleEdit(source)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="삭제"
                          onClick={() => handleDelete(source)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-sm text-muted-foreground">총 {sources.length}개 메타 소스</div>

      {/* Form Modal */}
      <DeviceMetaSourceFormModal
        source={isEditing ? selectedSource : null}
        open={isFormOpen}
        onClose={handleFormClose}
        onSave={() => {}}
      />

      {DeleteDialog}
    </>
  )
}

// ========== Sync Configs Panel ==========

function SyncConfigsPanel({ readOnly }: { readOnly: boolean }) {
  const addToast = useToastStore((s) => s.addToast)

  const { data: configs = [], isLoading } = useSyncSourceConfigs()
  const createMutation = useCreateSyncSourceConfig()
  const updateMutation = useUpdateSyncSourceConfig()
  const deleteMutation = useDeleteSyncSourceConfig()

  const [editingId, setEditingId] = useState<number | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  // Inline form state
  const [formSourceType, setFormSourceType] = useState<'device' | 'layer'>('device')
  const [formSourceName, setFormSourceName] = useState('')
  const [formTableName, setFormTableName] = useState('')
  const [formSchemaName, setFormSchemaName] = useState('public')
  const [formIsActive, setFormIsActive] = useState(true)
  const [formDescription, setFormDescription] = useState('')

  const { confirm: confirmDelete, ConfirmDialogElement: DeleteDialog } = useConfirm({
    title: '동기화 설정 삭제',
    description: '동기화 설정을 삭제하시겠습니까?',
    confirmText: '삭제',
    variant: 'destructive',
  })

  const resetForm = () => {
    setFormSourceType('device')
    setFormSourceName('')
    setFormTableName('')
    setFormSchemaName('public')
    setFormIsActive(true)
    setFormDescription('')
    setEditingId(null)
    setShowAddForm(false)
  }

  const handleAdd = () => {
    resetForm()
    setShowAddForm(true)
  }

  const handleEdit = (config: SyncSourceConfig) => {
    setFormSourceType(config.source_type)
    setFormSourceName(config.source_name)
    setFormTableName(config.table_name)
    setFormSchemaName(config.schema_name)
    setFormIsActive(config.is_active)
    setFormDescription(config.description ?? '')
    setEditingId(config.id)
    setShowAddForm(true)
  }

  const handleDelete = async (config: SyncSourceConfig) => {
    if (await confirmDelete()) {
      deleteMutation.mutate(config.id)
    }
  }

  const handleSave = () => {
    const payload: SyncSourceConfigCreate = {
      source_type: formSourceType,
      source_name: formSourceName.trim(),
      table_name: formTableName.trim(),
      schema_name: formSchemaName.trim() || 'public',
      column_mappings: [], // Column mappings managed separately if needed
      description: formDescription.trim() || undefined,
      is_active: formIsActive,
    }

    const onSuccess = () => {
      addToast('저장되었습니다.', 'success')
      resetForm()
    }
    const onError = () => {
      addToast('저장 중 오류가 발생했습니다.', 'error')
    }

    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, payload }, { onSuccess, onError })
    } else {
      createMutation.mutate(payload, { onSuccess, onError })
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">동기화 소스 설정</h2>
        {!readOnly && (
          <Button size="sm" onClick={handleAdd} disabled={showAddForm}>
            <Plus className="h-4 w-4 mr-1" />
            설정 추가
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        디바이스/레이어 동기화 시 참조할 소스 테이블을 설정합니다.
      </p>

      {/* Inline Add/Edit Form */}
      {showAddForm && (
        <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
          <h3 className="text-sm font-medium">
            {editingId !== null ? '설정 수정' : '새 설정'}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">
                소스 타입 <span className="text-destructive">*</span>
              </label>
              <select
                className="w-full border border-input bg-background px-3 py-2 rounded-md text-sm"
                value={formSourceType}
                onChange={(e) => setFormSourceType(e.target.value as 'device' | 'layer')}
              >
                <option value="device">device</option>
                <option value="layer">layer</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                소스 이름 <span className="text-destructive">*</span>
              </label>
              <Input
                value={formSourceName}
                onChange={(e) => setFormSourceName(e.target.value)}
                placeholder="예: MES_DEVICE_TABLE"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                테이블명 <span className="text-destructive">*</span>
              </label>
              <Input
                value={formTableName}
                onChange={(e) => setFormTableName(e.target.value)}
                placeholder="예: mes_devices"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">스키마명</label>
              <Input
                value={formSchemaName}
                onChange={(e) => setFormSchemaName(e.target.value)}
                placeholder="public"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1">설명</label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="설명 (선택)"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="sync-config-active"
              checked={formIsActive}
              onChange={(e) => setFormIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="sync-config-active" className="text-sm">
              활성
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={resetForm} disabled={isPending}>
              취소
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isPending || !formSourceName.trim() || !formTableName.trim()}
            >
              {isPending ? '저장 중...' : '저장'}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">로딩 중...</div>
      ) : configs.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          등록된 동기화 설정이 없습니다.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">소스 타입</th>
                <th className="px-4 py-3 text-left text-sm font-medium">소스 이름</th>
                <th className="px-4 py-3 text-left text-sm font-medium">테이블명</th>
                <th className="px-4 py-3 text-left text-sm font-medium">상태</th>
                <th className="px-4 py-3 text-right text-sm font-medium">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {configs.map((config) => (
                <tr
                  key={config.id}
                  className={`hover:bg-muted/50 ${
                    !config.is_active ? 'opacity-50 bg-muted/20' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-sm">
                    <Badge variant={config.source_type === 'device' ? 'default' : 'secondary'}>
                      {config.source_type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium">{config.source_name}</td>
                  <td className="px-4 py-3 text-sm font-mono text-xs">{config.table_name}</td>
                  <td className="px-4 py-3 text-sm">
                    {config.is_active ? (
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
                  <td className="px-4 py-3 text-sm text-right space-x-1">
                    {!readOnly && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="수정"
                          onClick={() => handleEdit(config)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="삭제"
                          onClick={() => handleDelete(config)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-sm text-muted-foreground">총 {configs.length}개 설정</div>

      {DeleteDialog}
    </>
  )
}
