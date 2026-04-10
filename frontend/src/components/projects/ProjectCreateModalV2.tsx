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
import { useCheckDuplicate } from '@/hooks/useDeviceMaster'
import { useStepCurrentLayers, useStepCurrentParts, useStepCurrentProcesses } from '@/hooks/useStepCurrent'
import { useBackboneConditions, useCreateProjectV2 } from '@/hooks/useProjects'
import { useLines } from '@/hooks/useLines'
import { Loader2, AlertTriangle, Info } from 'lucide-react'
import type { StepCurrentLayerItem } from '@/types/deviceMaster'
import type { ProjectCreateRequestV2 } from '@/types/project'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface CreateModalSelectionState {
  selectedLineId?: number
  selectedProcessId: string
  selectedPartId: string
  deviceType: 'full' | 'short'
  selectedLayerIds: string[]
  backboneConditionId: string
}

interface SubmitGuardInput {
  state: CreateModalSelectionState
  selectableLayerRefCount: number
  hasDuplicate: boolean
  isCheckingDuplicate: boolean
  isCreating: boolean
}

export function getStateAfterLineChange(
  value: string,
  prev: CreateModalSelectionState
): CreateModalSelectionState {
  const lineId = value ? Number(value) : undefined
  return {
    ...prev,
    selectedLineId: lineId,
    selectedProcessId: '',
    selectedPartId: '',
    deviceType: 'full',
    selectedLayerIds: [],
    backboneConditionId: '',
  }
}

export function getStateAfterProcessChange(
  value: string,
  prev: CreateModalSelectionState
): CreateModalSelectionState {
  return {
    ...prev,
    selectedProcessId: value,
    selectedPartId: '',
  }
}

export function isCreateSubmitDisabled({
  state,
  selectableLayerRefCount,
  hasDuplicate,
  isCheckingDuplicate,
  isCreating,
}: SubmitGuardInput): boolean {
  return (
    !state.selectedLineId ||
    !state.selectedProcessId ||
    !state.selectedPartId ||
    (state.deviceType === 'short' && state.selectedLayerIds.length === 0) ||
    selectableLayerRefCount === 0 ||
    hasDuplicate ||
    isCheckingDuplicate ||
    isCreating
  )
}

// @MX:NOTE: [AUTO] V2 project creation modal using device-ref based cascading dropdowns (SPEC-PROJECT-002 M2)
export function ProjectCreateModalV2({ open, onOpenChange }: Props) {
  const navigate = useNavigate()

  // ========== Cascading dropdown state ==========
  const [selectedLineId, setSelectedLineId] = useState<number | undefined>(undefined)
  const [selectedProcessId, setSelectedProcessId] = useState('')
  const [selectedPartId, setSelectedPartId] = useState('')

  // ========== Device type & layer selection ==========
  const [deviceType, setDeviceType] = useState<'full' | 'short'>('full')
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([])

  // ========== Backbone ==========
  const [backboneConditionId, setBackboneConditionId] = useState('')

  // ========== Data fetching ==========
  const { data: lines = [] } = useLines()

  const { data: processOptionsResponse } = useStepCurrentProcesses(selectedLineId)
  const processIds = processOptionsResponse?.process_ids ?? []
  const processOptions = useMemo(() => {
    return processIds.map((pid) => ({ value: pid, label: pid }))
  }, [processIds])

  const { data: partOptionsResponse } = useStepCurrentParts({
    line_id: selectedLineId,
    process_id: selectedProcessId,
  })
  const partOptions = (partOptionsResponse?.part_ids ?? []).map((partId) => ({ value: partId, label: partId }))

  const { data: stepCurrentLayersResponse, isLoading: layersLoading } = useStepCurrentLayers({
    line_id: selectedLineId,
    process_id: selectedProcessId,
    part_id: selectedPartId,
  })
  const deviceLayers = stepCurrentLayersResponse?.layers ?? []

  // ========== Backbone data ==========
  const { data: backboneConditions = [], isLoading: backboneLoading } =
    useBackboneConditions(selectedLineId)

  const backboneOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Backbone 없음 (빈 조건표)' }]
    backboneConditions.forEach((c) => {
      const approvedDate = c.approved_at ? new Date(c.approved_at).toLocaleDateString('ko-KR') : '-'
      opts.push({ value: String(c.id), label: `${c.process_id} | ${c.part_id} (v${c.revision}, ${approvedDate})` })
    })
    return opts
  }, [backboneConditions])

  // ========== Duplicate check ==========
  const checkDuplicate = useCheckDuplicate()

  useEffect(() => {
    if (selectedLineId && selectedProcessId && selectedPartId) {
      checkDuplicate.mutate({
        line_id: selectedLineId,
        process: selectedProcessId,
        part_id: selectedPartId,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLineId, selectedProcessId, selectedPartId])

  // ========== Mutation ==========
  const createProjectV2 = useCreateProjectV2()

  // ========== Reset handlers ==========
  const handleLineChange = useCallback((value: string) => {
    const nextState = getStateAfterLineChange(value, {
      selectedLineId,
      selectedProcessId,
      selectedPartId,
      deviceType,
      selectedLayerIds,
      backboneConditionId,
    })
    setSelectedLineId(nextState.selectedLineId)
    setSelectedProcessId(nextState.selectedProcessId)
    setSelectedPartId(nextState.selectedPartId)
    setDeviceType(nextState.deviceType)
    setSelectedLayerIds(nextState.selectedLayerIds)
    setBackboneConditionId(nextState.backboneConditionId)
  }, [backboneConditionId, deviceType, selectedLayerIds, selectedLineId, selectedPartId, selectedProcessId])

  const handleProcessIdChange = useCallback((value: string) => {
    const nextState = getStateAfterProcessChange(value, {
      selectedLineId,
      selectedProcessId,
      selectedPartId,
      deviceType,
      selectedLayerIds,
      backboneConditionId,
    })
    setSelectedProcessId(nextState.selectedProcessId)
    setSelectedPartId(nextState.selectedPartId)
  }, [backboneConditionId, deviceType, selectedLayerIds, selectedLineId, selectedPartId, selectedProcessId])

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
    (layers: StepCurrentLayerItem[]) => {
      if (selectedLayerIds.length === layers.length) {
        setSelectedLayerIds([])
      } else {
        setSelectedLayerIds(layers.map((l) => l.layer_id))
      }
    },
    [selectedLayerIds.length]
  )

  // ========== Computed display values ==========
  const duplicateData = checkDuplicate.data
  const hasDuplicate = duplicateData?.exists === true
  const selectableLayerRefs = deviceLayers.filter((layer) => !!layer.step_seq)

  // ========== Submission ==========
  const isSubmitDisabled = isCreateSubmitDisabled({
    state: {
      selectedLineId,
      selectedProcessId,
      selectedPartId,
      deviceType,
      selectedLayerIds,
      backboneConditionId,
    },
    selectableLayerRefCount: selectableLayerRefs.length,
    hasDuplicate,
    isCheckingDuplicate: checkDuplicate.isPending,
    isCreating: createProjectV2.isPending,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitDisabled || !selectedLineId) return

    const req: ProjectCreateRequestV2 = {
      line_id: selectedLineId,
      process: selectedProcessId,
      part_id: selectedPartId,
      device_type: deviceType,
      selected_layer_refs:
        deviceType === 'short'
          ? selectableLayerRefs
              .filter((layer) => selectedLayerIds.includes(layer.layer_id) && !!layer.step_seq)
              .map((layer) => ({ layer_id: layer.layer_id, step_seq: layer.step_seq! }))
          : [],
      backbone_condition_id: backboneConditionId ? Number(backboneConditionId) : null,
    }

    try {
      const result = await createProjectV2.mutateAsync(req)
      onOpenChange(false)
      navigate(`/process-conditions/${result.id}/edit`)
    } catch {
      // Error handled by TanStack Query
    }
  }

  const lineSelected = selectedLineId != null
  const allCascadingSelected = !!(selectedProcessId && selectedPartId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>새 공정 조건표 생성 (V2)</DialogTitle>
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

            {/* ===== 제품명(process_id) Combobox ===== */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                공정 ID <span className="text-destructive">*</span>
              </label>
              <Combobox
                options={processOptions}
                value={selectedProcessId}
                onChange={handleProcessIdChange}
                placeholder={lineSelected ? '공정(process_id)을 선택하세요' : '라인을 먼저 선택하세요'}
                searchPlaceholder="공정(process_id) 검색..."
                disabled={!lineSelected}
                required
              />
            </div>

            {/* ===== Part ID Select ===== */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Part ID <span className="text-destructive">*</span>
              </label>
              <Combobox
                options={partOptions}
                value={selectedPartId}
                onChange={handlePartIdChange}
                placeholder={selectedProcessId ? 'Part ID를 선택하세요' : '공정을 먼저 선택하세요'}
                searchPlaceholder="Part ID 검색..."
                disabled={!selectedProcessId}
                required
              />
            </div>

            {/* ===== Duplicate Warning ===== */}
            {hasDuplicate && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  동일 참조의 공정 조건표가 이미 존재합니다
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
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    조회 결과가 없습니다. step_current 동기화 지연 또는 데이터 stale 상태일 수 있습니다.
                    {stepCurrentLayersResponse?.last_successful_sync_at && (
                      <span className="block mt-1 text-xs opacity-80">
                        마지막 동기화 성공 시각: {new Date(stepCurrentLayersResponse.last_successful_sync_at).toLocaleString('ko-KR')}
                      </span>
                    )}
                  </div>
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
                            key={`${layer.step_seq}-${layer.layer_id}`}
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
                  value={backboneConditionId}
                  onChange={setBackboneConditionId}
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
                {lineSelected && !backboneLoading && backboneConditions.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    이 라인에 Approved 상태의 Backbone 공정 조건표가 없습니다.
                  </p>
                )}
              </div>
            )}

            {/* ===== Header Preview ===== */}
            {allCascadingSelected && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-1.5 font-medium mb-2 text-muted-foreground">
                  <Info className="h-4 w-4" />
                  공정 조건표 헤더 미리보기
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <span className="text-muted-foreground">제품명</span>
                  <span>{selectedProcessId}</span>

                  <span className="text-muted-foreground">공정</span>
                  <span>-</span>

                  <span className="text-muted-foreground">Part ID</span>
                  <span>{selectedPartId}</span>

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
                    {backboneConditionId
                      ? backboneOptions.find((o) => o.value === backboneConditionId)?.label ?? '-'
                      : '-'}
                  </span>
                </div>

                {stepCurrentLayersResponse?.stale && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    운영 안내: step_current 최신성(SLA) 기준이 초과되어 결과가 오래되었을 수 있습니다.
                  </p>
                )}
              </div>
            )}

            {/* ===== Error display ===== */}
            {checkDuplicate.isError && (
              <p className="text-xs text-amber-600">
                중복 확인에 실패했습니다. 네트워크를 확인해주세요.
              </p>
            )}
            {createProjectV2.isError && (
              <p className="text-sm text-destructive">
                {(() => {
                  const err = createProjectV2.error as { response?: { status?: number; data?: { detail?: string } } }
                  const status = err?.response?.status
                  if (status === 409) {
                    return err?.response?.data?.detail || '동일한 디바이스 조합의 활성 공정 조건표가 이미 존재합니다.'
                  }
                  if (status === 404) return '디바이스 정보를 찾을 수 없습니다. 입력값을 확인해주세요.'
                  if (status === 400) return err?.response?.data?.detail || '입력값이 올바르지 않습니다.'
                  return '공정 조건표 생성에 실패했습니다. 다시 시도해주세요.'
                })()}
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
