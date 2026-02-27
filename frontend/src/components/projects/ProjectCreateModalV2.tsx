import { useState, useMemo, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { useDeviceMasters, useDeviceLayers, useCheckDuplicate } from '@/hooks/useDeviceMaster'
import { useCreateProjectV2 } from '@/hooks/useProjects'
import { useBackboneProducts } from '@/hooks/useProducts'
import { useLines } from '@/hooks/useLines'
import { Loader2, AlertTriangle, Info } from 'lucide-react'
import type { DeviceMaster, DeviceLayerItem } from '@/types/deviceMaster'
import type { ProjectCreateRequestV2 } from '@/types/project'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// @MX:NOTE: [AUTO] V2 project creation modal using device-ref based cascading dropdowns (SPEC-PROJECT-002 M2)
export function ProjectCreateModalV2({ open, onOpenChange }: Props) {
  const navigate = useNavigate()

  // ========== Cascading dropdown state ==========
  const [selectedLineId, setSelectedLineId] = useState<number | undefined>(undefined)
  const [selectedProductName, setSelectedProductName] = useState('')
  const [selectedProcess, setSelectedProcess] = useState('')
  const [selectedPartId, setSelectedPartId] = useState('')

  // ========== Device type & layer selection ==========
  const [deviceType, setDeviceType] = useState<'full' | 'short'>('full')
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([])

  // ========== Backbone ==========
  const [backboneProductId, setBackboneProductId] = useState('')

  // ========== Data fetching ==========
  const { data: lines = [] } = useLines()

  const { data: deviceMastersResponse } = useDeviceMasters({
    line_id: selectedLineId,
    size: 1000,
  })

  const deviceMasters: DeviceMaster[] = deviceMastersResponse?.items ?? []

  // ========== Cascading filter logic ==========
  const productNameOptions = useMemo(() => {
    if (!selectedLineId) return []
    const uniqueNames = [...new Set(deviceMasters.map((dm) => dm.product_name))].sort()
    return uniqueNames.map((name) => ({ value: name, label: name }))
  }, [selectedLineId, deviceMasters])

  const processOptions = useMemo(() => {
    if (!selectedProductName) return []
    const filtered = deviceMasters.filter((dm) => dm.product_name === selectedProductName)
    const uniqueProcesses = [...new Set(filtered.map((dm) => dm.process))].sort()
    return uniqueProcesses.map((p) => ({ value: p, label: p }))
  }, [selectedProductName, deviceMasters])

  const partIdOptions = useMemo(() => {
    if (!selectedProductName || !selectedProcess) return []
    const filtered = deviceMasters.filter(
      (dm) => dm.product_name === selectedProductName && dm.process === selectedProcess
    )
    const uniquePartIds = [
      ...new Set(filtered.map((dm) => dm.part_id).filter((pid): pid is string => pid !== null)),
    ].sort()
    // Include a "N/A" entry if any device_master has null part_id
    const hasNullPartId = filtered.some((dm) => dm.part_id === null)
    const options = uniquePartIds.map((pid) => ({ value: pid, label: pid }))
    if (hasNullPartId) {
      options.unshift({ value: '__NULL__', label: 'N/A' })
    }
    return options
  }, [selectedProductName, selectedProcess, deviceMasters])

  // ========== Resolve device master ==========
  const resolvedDeviceMaster: DeviceMaster | null = useMemo(() => {
    if (!selectedProductName || !selectedProcess || !selectedPartId) return null
    const partIdToMatch = selectedPartId === '__NULL__' ? null : selectedPartId
    return (
      deviceMasters.find(
        (dm) =>
          dm.product_name === selectedProductName &&
          dm.process === selectedProcess &&
          dm.part_id === partIdToMatch
      ) ?? null
    )
  }, [selectedProductName, selectedProcess, selectedPartId, deviceMasters])

  const resolvedDeviceMasterId = resolvedDeviceMaster?.id ?? null

  // ========== Layer data ==========
  const { data: deviceLayers = [], isLoading: layersLoading } =
    useDeviceLayers(resolvedDeviceMasterId)

  // ========== Backbone data ==========
  const { data: backboneProducts = [], isLoading: backboneLoading } =
    useBackboneProducts(selectedLineId)

  const backboneOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Backbone 없음 (빈 조건표)' }]
    backboneProducts.forEach((p) => {
      const versionSuffix = p.revision
        ? ` (v${p.revision}${p.approved_at ? ', ' + new Date(p.approved_at).toLocaleDateString('ko-KR') : ''})`
        : ''
      opts.push({ value: String(p.id), label: `${p.product_name}${versionSuffix}` })
    })
    return opts
  }, [backboneProducts])

  // ========== Duplicate check ==========
  const checkDuplicate = useCheckDuplicate()

  useEffect(() => {
    if (selectedLineId && selectedProductName && selectedProcess && selectedPartId) {
      const partId = selectedPartId === '__NULL__' ? '' : selectedPartId
      checkDuplicate.mutate({
        line_id: selectedLineId,
        product_name: selectedProductName,
        process: selectedProcess,
        part_id: partId,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLineId, selectedProductName, selectedProcess, selectedPartId])

  // ========== Mutation ==========
  const createProjectV2 = useCreateProjectV2()

  // ========== Reset handlers ==========
  const handleLineChange = useCallback((value: string) => {
    const lineId = value ? Number(value) : undefined
    setSelectedLineId(lineId)
    setSelectedProductName('')
    setSelectedProcess('')
    setSelectedPartId('')
    setDeviceType('full')
    setSelectedLayerIds([])
    setBackboneProductId('')
  }, [])

  const handleProductNameChange = useCallback((value: string) => {
    setSelectedProductName(value)
    setSelectedProcess('')
    setSelectedPartId('')
  }, [])

  const handleProcessChange = useCallback((value: string) => {
    setSelectedProcess(value)
    setSelectedPartId('')
  }, [])

  const handlePartIdChange = useCallback((value: string) => {
    setSelectedPartId(value)
  }, [])

  // ========== Layer selection helpers ==========
  const handleToggleLayer = useCallback((layerId: string) => {
    setSelectedLayerIds((prev) =>
      prev.includes(layerId) ? prev.filter((id) => id !== layerId) : [...prev, layerId]
    )
  }, [])

  const handleToggleAll = useCallback(
    (layers: DeviceLayerItem[]) => {
      if (selectedLayerIds.length === layers.length) {
        setSelectedLayerIds([])
      } else {
        setSelectedLayerIds(layers.map((l) => l.layer_id))
      }
    },
    [selectedLayerIds.length]
  )

  // ========== Submission ==========
  const isSubmitDisabled =
    !selectedLineId ||
    !selectedProductName ||
    !selectedProcess ||
    !selectedPartId ||
    (deviceType === 'short' && selectedLayerIds.length === 0) ||
    createProjectV2.isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitDisabled || !selectedLineId) return

    const req: ProjectCreateRequestV2 = {
      line_id: selectedLineId,
      product_name: selectedProductName,
      process: selectedProcess,
      part_id: selectedPartId === '__NULL__' ? '' : selectedPartId,
      device_type: deviceType,
      selected_layer_ids: deviceType === 'short' ? selectedLayerIds : undefined,
      backbone_product_id: backboneProductId ? Number(backboneProductId) : null,
    }

    try {
      const result = await createProjectV2.mutateAsync(req)
      onOpenChange(false)
      navigate(`/projects/${result.id}/edit`)
    } catch {
      // Error handled by TanStack Query
    }
  }

  // ========== Computed display values ==========
  const lineSelected = selectedLineId != null
  const allCascadingSelected = !!(selectedProductName && selectedProcess && selectedPartId)

  const duplicateData = checkDuplicate.data
  const hasDuplicate = duplicateData?.exists === true

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>새 프로젝트 생성 (V2)</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* ===== Line Select ===== */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                라인 <span className="text-destructive">*</span>
              </label>
              <select
                value={selectedLineId ?? ''}
                onChange={(e) => handleLineChange(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                required
                aria-label="라인 선택"
              >
                <option value="">라인을 선택하세요</option>
                {lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.line_name}
                  </option>
                ))}
              </select>
            </div>

            {/* ===== Product Name Combobox ===== */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                제품명 <span className="text-destructive">*</span>
              </label>
              <Combobox
                options={productNameOptions}
                value={selectedProductName}
                onChange={handleProductNameChange}
                placeholder={lineSelected ? '제품명을 선택하세요' : '라인을 먼저 선택하세요'}
                searchPlaceholder="제품명 검색..."
                disabled={!lineSelected}
                required
              />
            </div>

            {/* ===== Process Combobox ===== */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                공정 <span className="text-destructive">*</span>
              </label>
              <Combobox
                options={processOptions}
                value={selectedProcess}
                onChange={handleProcessChange}
                placeholder={
                  selectedProductName ? '공정을 선택하세요' : '제품명을 먼저 선택하세요'
                }
                searchPlaceholder="공정 검색..."
                disabled={!selectedProductName}
                required
              />
            </div>

            {/* ===== Part ID Combobox ===== */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Part ID <span className="text-destructive">*</span>
              </label>
              <Combobox
                options={partIdOptions}
                value={selectedPartId}
                onChange={handlePartIdChange}
                placeholder={
                  selectedProcess ? 'Part ID를 선택하세요' : '공정을 먼저 선택하세요'
                }
                searchPlaceholder="Part ID 검색..."
                disabled={!selectedProcess}
                required
              />
            </div>

            {/* ===== Duplicate Warning ===== */}
            {hasDuplicate && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  동일 참조의 프로젝트가 이미 존재합니다
                  {duplicateData?.existing_project_id != null && (
                    <>
                      {' '}
                      (ID: {duplicateData.existing_project_id}
                      {duplicateData.existing_project_status
                        ? `, ${duplicateData.existing_project_status}`
                        : ''}
                      {duplicateData.existing_project_revision != null
                        ? `, v${duplicateData.existing_project_revision}`
                        : ''}
                      )
                    </>
                  )}
                </span>
              </div>
            )}

            {/* ===== Device Type Selector ===== */}
            {allCascadingSelected && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  장치 타입 <span className="text-destructive">*</span>
                </label>
                <div className="flex gap-1 rounded-md border border-input p-1 w-fit">
                  <button
                    type="button"
                    onClick={() => {
                      setDeviceType('full')
                      setSelectedLayerIds([])
                    }}
                    className={`px-4 py-1.5 text-sm rounded transition-colors ${
                      deviceType === 'full'
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent text-muted-foreground'
                    }`}
                    aria-pressed={deviceType === 'full'}
                  >
                    Full
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeviceType('short')}
                    className={`px-4 py-1.5 text-sm rounded transition-colors ${
                      deviceType === 'short'
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent text-muted-foreground'
                    }`}
                    aria-pressed={deviceType === 'short'}
                  >
                    Short
                  </button>
                </div>
              </div>
            )}

            {/* ===== Layer Selection Panel (Short mode) ===== */}
            {allCascadingSelected && deviceType === 'short' && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  레이어 선택 <span className="text-destructive">*</span>
                </label>

                {layersLoading ? (
                  <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    레이어 로딩 중...
                  </div>
                ) : deviceLayers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    등록된 레이어가 없습니다.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <button
                        type="button"
                        onClick={() => handleToggleAll(deviceLayers)}
                        className="text-xs text-primary hover:underline"
                      >
                        {selectedLayerIds.length === deviceLayers.length
                          ? '전체 해제'
                          : '전체 선택'}
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {selectedLayerIds.length}/{deviceLayers.length} 레이어 선택됨
                      </span>
                    </div>

                    <div
                      className="max-h-48 overflow-y-auto rounded-md border border-input divide-y divide-border"
                      role="listbox"
                      aria-label="레이어 목록"
                    >
                      {deviceLayers.map((layer) => {
                        const isChecked = selectedLayerIds.includes(layer.layer_id)
                        return (
                          <label
                            key={layer.id}
                            className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent/50"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleLayer(layer.layer_id)}
                              className="rounded border-input"
                              aria-label={`${layer.layer_id} - ${layer.descript ?? ''}`}
                            />
                            <span className="truncate">
                              {layer.layer_id}
                              {layer.descript ? ` - ${layer.descript}` : ''}
                              {layer.step_seq ? ` (Step: ${layer.step_seq})` : ''}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ===== Backbone Dropdown ===== */}
            {allCascadingSelected && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">Backbone</label>
                <Combobox
                  options={backboneOptions}
                  value={backboneProductId}
                  onChange={setBackboneProductId}
                  placeholder={
                    !lineSelected
                      ? '라인을 먼저 선택하세요'
                      : backboneLoading
                        ? '로딩 중...'
                        : 'Backbone을 선택하세요 (선택사항)'
                  }
                  searchPlaceholder="Backbone 검색..."
                  disabled={!lineSelected || backboneLoading}
                />
                {lineSelected && !backboneLoading && backboneProducts.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    이 라인에 Approved 상태의 Backbone 프로젝트가 없습니다.
                  </p>
                )}
              </div>
            )}

            {/* ===== Header Preview ===== */}
            {resolvedDeviceMaster && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-1.5 font-medium mb-2 text-muted-foreground">
                  <Info className="h-4 w-4" />
                  프로젝트 헤더 미리보기
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <span className="text-muted-foreground">제품명</span>
                  <span>{resolvedDeviceMaster.product_name}</span>

                  <span className="text-muted-foreground">공정</span>
                  <span>{resolvedDeviceMaster.process}</span>

                  <span className="text-muted-foreground">Part ID</span>
                  <span>{resolvedDeviceMaster.part_id ?? 'N/A'}</span>

                  <span className="text-muted-foreground">Device Type</span>
                  <span className="capitalize">{deviceType}</span>

                  <span className="text-muted-foreground">레이어</span>
                  <span>
                    {layersLoading
                      ? '로딩 중...'
                      : deviceType === 'full'
                        ? `${deviceLayers.length}개`
                        : `${selectedLayerIds.length}/${deviceLayers.length}개`}
                  </span>

                  <span className="text-muted-foreground">Backbone</span>
                  <span>
                    {backboneProductId
                      ? backboneOptions.find((o) => o.value === backboneProductId)?.label ?? '-'
                      : '-'}
                  </span>
                </div>

                {/* Enrichment metadata from device_master (REQ-PROJ-053) */}
                {resolvedDeviceMaster.enrichment &&
                  Object.keys(resolvedDeviceMaster.enrichment).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        Header Metadata
                      </div>
                      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
                        {Object.entries(resolvedDeviceMaster.enrichment).flatMap(
                          ([_source, fields]) =>
                            Object.entries(fields as Record<string, unknown>).map(
                              ([key, value]) => [
                                <span key={`${key}-label`} className="text-muted-foreground">
                                  {key.replace(/_/g, ' ')}
                                </span>,
                                <span key={`${key}-value`}>{String(value ?? '-')}</span>,
                              ]
                            )
                        )}
                      </div>
                    </div>
                  )}
              </div>
            )}

            {/* ===== Error display ===== */}
            {createProjectV2.isError && (
              <p className="text-sm text-destructive">
                프로젝트 생성에 실패했습니다. 다시 시도해주세요.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={isSubmitDisabled}>
              {createProjectV2.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              생성
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
