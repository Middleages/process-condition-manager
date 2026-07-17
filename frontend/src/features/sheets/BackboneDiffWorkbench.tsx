import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'

import { ErrorMessage, LoadingMessage } from '@/shared/components/StatusMessage'
import { cn } from '@/shared/lib/cn'

export type BackboneDiffClassification =
  | 'added'
  | 'changed'
  | 'cleared'
  | 'removed'
  | 'unchanged'

export type BackboneDiffRowStatus = 'matched' | 'added' | 'removed'

export type BackboneDiffLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type BackboneDiffLayerStatus = 'available' | 'unavailable'

export type BackboneDiffJumpStatus = 'available' | 'deleted'

export type BackboneDiffActivationStatus = 'available' | 'deleted' | 'removed' | 'unavailable'


export interface BackboneDiffJumpTarget {
  readonly kind: 'condition' | 'cell'
  readonly layerKey: string
  readonly classification: BackboneDiffClassification
  readonly jumpStatus: BackboneDiffJumpStatus
  readonly rowRef: string | null
  readonly conditionId: number
  readonly parameterCode: string | null
  readonly sourceConditionId: number | null
}

export interface BackboneDiffCounts {
  readonly layerCount: number
  readonly availableLayerCount: number
  readonly unavailableLayerCount: number
  readonly rowCount: number
  readonly cellCount: number
  readonly fullRowCount: number
  readonly fullCellCount: number
  readonly ambiguousLineageCount: number
  readonly addedCount: number
  readonly changedCount: number
  readonly clearedCount: number
  readonly removedCount: number
  readonly unchangedCount: number
}

export interface BackboneDiffLayerSummary {
  readonly layerKey: string
  readonly layerStatus: BackboneDiffLayerStatus
  readonly baselineConditionCount: number
  readonly currentConditionCount: number
  readonly rowCount: number
  readonly cellCount: number
  readonly fullRowCount: number
  readonly fullCellCount: number
  readonly ambiguousLineageCount: number
  readonly changedCount: number
}

export interface BackboneDiffPreviewItem {
  readonly itemKind: 'row' | 'cell'
  readonly classification: BackboneDiffClassification
  readonly layerKey: string
  readonly effectiveConditionIndex: number
  readonly itemSortKey: readonly (string | number | null)[]
  readonly rowRef: string | null
  readonly cellScope: string | null
  readonly rowStatus?: BackboneDiffRowStatus | null
  readonly parameterCode?: string | null
}

export interface BackboneDiffRoot {
  readonly scope: string
  readonly basisHash: string
  readonly counts: BackboneDiffCounts
  readonly layerSummaries: readonly BackboneDiffLayerSummary[]
  readonly changedPreview: readonly BackboneDiffPreviewItem[]
}

export interface BackboneDiffConditionItem {
  readonly rowRef: string
  readonly rowStatus: BackboneDiffRowStatus
  readonly effectiveConditionIndex: number
  readonly identity: number
  readonly baselineCondition: {
    readonly conditionId: number | null
    readonly sourceConditionId: number | null
    readonly label: string | null
    readonly conditionIndex: number | null
    readonly isPor: boolean | null
  } | null
  readonly currentCondition: {
    readonly conditionId: number | null
    readonly sourceConditionId: number | null
    readonly label: string | null
    readonly conditionIndex: number | null
    readonly isPor: boolean | null
  } | null
  readonly rowMetadata?: {
    readonly labelChanged: boolean
    readonly indexChanged: boolean
    readonly porChanged: boolean
  }
  readonly filteredCellCount: number
  readonly fullCellCount: number
  readonly jumpStatus: BackboneDiffJumpStatus
  readonly cellScope: string | null
}

export interface BackboneDiffCellItem {
  readonly classification: BackboneDiffClassification
  readonly reason: string
  readonly parameterCode: string
  readonly parameterSort: number
  readonly baselineValue: string | null
  readonly currentValue: string | null
  readonly jumpStatus: BackboneDiffJumpStatus
}

export interface BackboneDiffFilter {
  readonly classification: readonly BackboneDiffClassification[]
  readonly layerKey: string
  readonly categoryCode: string
  readonly parameterCode: string
  readonly includeUnchanged: boolean
}

export interface BranchState<T> {
  readonly status: BackboneDiffLoadStatus
  readonly basisHash: string
  readonly scope: string
  readonly items: readonly T[]
  readonly nextCursor: string | null
  readonly error: string | null
  readonly nextPageError: string | null
}

export interface PreviewState<T> {
  readonly status: BackboneDiffLoadStatus
  readonly items: readonly T[]
  readonly nextCursor: string | null
  readonly error: string | null
  readonly nextPageError: string | null
}

export interface BackboneDiffWorkbenchProps {
  readonly root: BackboneDiffRoot | null
  readonly rootStatus: BackboneDiffLoadStatus
  readonly rootError: string | null
  readonly onRetryRoot: () => void
  readonly onRefreshAnnouncementReset: () => void
  readonly refreshAnnouncement: string | null

  readonly filters: BackboneDiffFilter
  readonly onFiltersChange: (next: BackboneDiffFilter) => void

  readonly preview: PreviewState<BackboneDiffPreviewItem>
  readonly onLoadMorePreview: (cursor: string | null) => void
  readonly onRetry: () => void

  readonly layerConditionBranches: Readonly<Record<string, BranchState<BackboneDiffConditionItem>>>
  readonly onOpenLayer: (layerKey: string) => void
  readonly onLoadMoreConditions: (layerKey: string, cursor: string | null) => void
  readonly onRetryConditions: (layerKey: string) => void

  readonly cellBranches: Readonly<Record<string, BranchState<BackboneDiffCellItem>>>
  readonly onOpenCells: (rowRef: string) => void
  readonly onLoadMoreCells: (rowRef: string, cursor: string | null) => void
  readonly onRetryCells: (rowRef: string) => void
  readonly onCloseBranch?: (layerKey: string) => void
  readonly onCloseCell?: (rowRef: string) => void

  readonly onActivateTarget: (target: BackboneDiffJumpTarget) => void

  readonly baselineUnavailableCopy: string | null
}

const CLASSIFICATIONS: readonly BackboneDiffClassification[] = [
  'added',
  'changed',
  'cleared',
  'removed',
  'unchanged',
]

function formatNullableText(value: string | null | undefined): string {
  return value === null || value === undefined ? '미지정' : value
}

function formatFactValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '미지정'
  }
  if (typeof value === 'boolean') {
    return value ? 'O' : 'X'
  }
  return String(value)
}

function formatRowFactDiff({
  baselineValue,
  currentValue,
  defaultBaselineValue,
  defaultCurrentValue,
  showDiff,
}: {
  baselineValue: string | number | boolean | null | undefined
  currentValue: string | number | boolean | null | undefined
  defaultBaselineValue: string
  defaultCurrentValue: string
  showDiff: boolean
}): string {
  const normalizedBaseline = formatFactValue(baselineValue)
  const normalizedCurrent = formatFactValue(currentValue)

  const displayedBaseline =
    baselineValue === null || baselineValue === undefined || baselineValue === ''
      ? defaultBaselineValue
      : normalizedBaseline
  const displayedCurrent =
    currentValue === null || currentValue === undefined || currentValue === ''
      ? defaultCurrentValue
      : normalizedCurrent

  if (showDiff) {
    return `${displayedBaseline} → ${displayedCurrent}`
  }

  return displayedCurrent
}

function shouldShowRowFactDiff(rowStatus: BackboneDiffRowStatus, hasChanged: boolean | undefined): boolean {
  return rowStatus === 'added' || rowStatus === 'removed' || hasChanged === true
}

function formatDefaultForRowSide(rowStatus: BackboneDiffRowStatus, side: 'baseline' | 'current'): string {
  if (side === 'baseline' && rowStatus === 'added') {
    return '기준 없음'
  }
  if (side === 'current' && rowStatus === 'removed') {
    return '현재 없음'
  }
  return side === 'baseline' ? '기준 없음' : '현재 없음'
}

export interface BackboneDiffConditionFactDiff {
  readonly baselineToCurrentLabel: string
  readonly baselineToCurrentIndex: string
  readonly baselineToCurrentPor: string
}

export function formatBackboneDiffConditionFacts(params: {
  rowStatus: BackboneDiffRowStatus
  baselineConditionLabel: string | null | undefined
  currentConditionLabel: string | null | undefined
  baselineConditionIndex: number | null | undefined
  currentConditionIndex: number | null | undefined
  baselineConditionPor: boolean | null | undefined
  currentConditionPor: boolean | null | undefined
  rowMetadata?: {
    readonly labelChanged: boolean
    readonly indexChanged: boolean
    readonly porChanged: boolean
  }
}): BackboneDiffConditionFactDiff {
  const baselineLabel = params.baselineConditionLabel
  const currentLabel = params.currentConditionLabel
  const baselineConditionIndex = params.baselineConditionIndex
  const currentConditionIndex = params.currentConditionIndex
  const baselinePor = params.baselineConditionPor
  const currentPor = params.currentConditionPor

  return {
    baselineToCurrentLabel: formatRowFactDiff({
      baselineValue: baselineLabel,
      currentValue: currentLabel,
      defaultBaselineValue: formatDefaultForRowSide(params.rowStatus, 'baseline'),
      defaultCurrentValue: formatDefaultForRowSide(params.rowStatus, 'current'),
      showDiff: shouldShowRowFactDiff(
        params.rowStatus,
        params.rowMetadata?.labelChanged,
      ),
    }),
    baselineToCurrentIndex: formatRowFactDiff({
      baselineValue: baselineConditionIndex,
      currentValue: currentConditionIndex,
      defaultBaselineValue: formatDefaultForRowSide(params.rowStatus, 'baseline'),
      defaultCurrentValue: formatDefaultForRowSide(params.rowStatus, 'current'),
      showDiff: shouldShowRowFactDiff(
        params.rowStatus,
        params.rowMetadata?.indexChanged,
      ),
    }),
    baselineToCurrentPor: formatRowFactDiff({
      baselineValue: baselinePor,
      currentValue: currentPor,
      defaultBaselineValue: formatDefaultForRowSide(params.rowStatus, 'baseline'),
      defaultCurrentValue: formatDefaultForRowSide(params.rowStatus, 'current'),
      showDiff: shouldShowRowFactDiff(
        params.rowStatus,
        params.rowMetadata?.porChanged,
      ),
    }),
  }
}

export function BackboneDiffWorkbench({
  root,
  rootStatus,
  rootError,
  onRetryRoot,
  onRefreshAnnouncementReset,
  refreshAnnouncement,
  filters,
  onFiltersChange,
  preview,
  onLoadMorePreview,
  onRetry,
  layerConditionBranches,
  onOpenLayer,
  onLoadMoreConditions,
  onRetryConditions,
  cellBranches,
  onOpenCells,
  onLoadMoreCells,
  onRetryCells,
  onCloseBranch,
  onCloseCell,
  onActivateTarget,
  baselineUnavailableCopy,
}: BackboneDiffWorkbenchProps) {
  const [expandedLayerKey, setExpandedLayerKey] = useState<string | null>(null)
  const [expandedRowRef, setExpandedRowRef] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState<string | null>(null)

  useEffect(() => {
    setExpandedLayerKey(null)
    setExpandedRowRef(null)
    onRefreshAnnouncementReset()
  }, [root?.basisHash, onRefreshAnnouncementReset])

  useEffect(() => {
    if (announcement !== null) {
      const announcementTimer = window.setTimeout(() => setAnnouncement(null), 3500)
      return () => window.clearTimeout(announcementTimer)
    }
    return
  }, [announcement])

  const selectedClassifications = useMemo(
    () => new Set<BackboneDiffClassification>(filters.classification),
    [filters.classification],
  )

  const hasUnavailableCopy = baselineUnavailableCopy !== null && baselineUnavailableCopy.trim() !== ''
  const hasRefreshAnnouncement = refreshAnnouncement !== null && refreshAnnouncement.trim() !== ''

  const emitAnnouncement = useCallback((message: string | null) => {
    setAnnouncement(message)
  }, [])

  const handleClassificationToggle = useCallback(
    (classification: BackboneDiffClassification, checked: boolean) => {
      const next = new Set(filters.classification)
      if (checked) {
        next.add(classification)
      } else {
        next.delete(classification)
      }

      const includeUnchanged =
        classification === 'unchanged'
          ? checked
          : filters.includeUnchanged
      onFiltersChange({
        ...filters,
        classification: [...next],
        includeUnchanged,
      })
    },
    [filters, onFiltersChange],
  )

  const handleIncludeUnchanged = useCallback(
    (includeUnchanged: boolean) => {
      const next = new Set(filters.classification)
      if (!includeUnchanged) {
        next.delete('unchanged')
      }
      onFiltersChange({
        ...filters,
        includeUnchanged,
        classification: [...next],
      })
    },
    [filters, onFiltersChange],
  )

  const handleTextFilter = useCallback(
    (field: 'layerKey' | 'categoryCode' | 'parameterCode', value: string) => {
      onFiltersChange({
        ...filters,
        [field]: value,
      })
    },
    [filters, onFiltersChange],
  )

  const handleLayerKeyFilter = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      handleTextFilter('layerKey', event.currentTarget.value)
    },
    [handleTextFilter],
  )

  const handleCategoryFilter = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      handleTextFilter('categoryCode', event.currentTarget.value)
    },
    [handleTextFilter],
  )

  const handleParameterFilter = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      handleTextFilter('parameterCode', event.currentTarget.value)
    },
    [handleTextFilter],
  )

  const toggleLayer = useCallback(
    (layerKey: string) => {
      setExpandedLayerKey((current) => {
        if (current === layerKey) {
          if (expandedRowRef !== null) {
            onCloseCell?.(expandedRowRef)
          }
          onCloseBranch?.(layerKey)
          setExpandedRowRef(null)
          return null
        }

        if (current !== null) {
          if (expandedRowRef !== null) {
            onCloseCell?.(expandedRowRef)
            setExpandedRowRef(null)
          }
          onCloseBranch?.(current)
        }

        if (layerConditionBranches[layerKey] === undefined) {
          onOpenLayer(layerKey)
        }
        return layerKey
      })
    },
    [layerConditionBranches, onCloseBranch, onCloseCell, onOpenLayer, expandedRowRef],
  )

  const toggleRow = useCallback(
    (rowRef: string, scopeAvailable: boolean) => {
      if (expandedLayerKey === null) {
        return
      }
      if (!scopeAvailable && expandedRowRef !== rowRef) {
        return
      }

      setExpandedRowRef((current) => {
        if (current === rowRef) {
          onCloseCell?.(rowRef)
          return null
        }

        if (current !== null) {
          onCloseCell?.(current)
        }

        if (cellBranches[rowRef] === undefined) {
          onOpenCells(rowRef)
        }

        return rowRef
      })
    },
    [cellBranches, expandedLayerKey, onCloseCell, onOpenCells],
  )

  const activateTarget = useCallback(
    (target: BackboneDiffJumpTarget) => {
      const activated = activateBackboneJumpTarget(target, onActivateTarget)
      if (!activated) {
        if (target.classification === 'removed') {
          emitAnnouncement('삭제된 대상은 이동할 수 없습니다.')
        } else if (target.jumpStatus === 'deleted') {
          emitAnnouncement('삭제된 대상으로는 위치를 이동할 수 없습니다.')
        } else if (target.parameterCode === null) {
          emitAnnouncement('현재 위치로 이동할 수 없습니다.')
        }
      }
      return activated
    },
    [emitAnnouncement, onActivateTarget],
  )

  const renderActivationButtonText = useCallback((state: BackboneDiffActivationStatus) => {
    if (state === 'available') return '위치로 이동'
    if (state === 'removed') return '제거됨'
    if (state === 'unavailable') return '이동 불가'
    return '삭제됨'
  }, [])

  const previewCards = root?.changedPreview ?? []

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas p-2" aria-label="백본 비교 워크벤치">
      <div className="mb-3 rounded-md border border-border-subtle bg-surface p-2">
        <h3 className="font-semibold">요약</h3>
        {rootStatus === 'loading' ? <LoadingMessage>루트 조회 중...</LoadingMessage> : null}
        {rootStatus === 'error' && rootError !== null ? (
          <>
            <ErrorMessage message={rootError} />
            <button
              className="mt-2 rounded-sm border border-brand-700 px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              onClick={onRetryRoot}
              type="button"
            >
              루트 다시 시도
            </button>
          </>
        ) : null}

        {root !== null ? (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded border border-border-subtle bg-canvas px-2 py-1">변경 레이어 <strong>{root.counts.layerCount}</strong></div>
            <div className="rounded border border-border-subtle bg-canvas px-2 py-1">조건 <strong>{root.counts.rowCount}</strong></div>
            <div className="rounded border border-border-subtle bg-canvas px-2 py-1">셀 <strong>{root.counts.cellCount}</strong></div>
            <div className="rounded border border-border-subtle bg-canvas px-2 py-1">
              기준 <strong>{root.basisHash.slice(0, 8)}</strong>
            </div>
            <div className="rounded border border-border-subtle bg-canvas px-2 py-1">
              사용 가능 레이어 <strong>{root.counts.availableLayerCount}</strong>
            </div>
            <div className="rounded border border-border-subtle bg-canvas px-2 py-1">
              비교 불가 레이어 <strong>{root.counts.unavailableLayerCount}</strong>
            </div>
            <div className="rounded border border-border-subtle bg-canvas px-2 py-1">
              불일치 라인 <strong>{root.counts.ambiguousLineageCount}</strong>
            </div>
            <div className="rounded border border-border-subtle bg-canvas px-2 py-1">추가 <strong>{root.counts.addedCount}</strong></div>
            <div className="rounded border border-border-subtle bg-canvas px-2 py-1">변경 <strong>{root.counts.changedCount}</strong></div>
            <div className="rounded border border-border-subtle bg-canvas px-2 py-1">비움 <strong>{root.counts.clearedCount}</strong></div>
            <div className="rounded border border-border-subtle bg-canvas px-2 py-1">제거 <strong>{root.counts.removedCount}</strong></div>
            <div className="rounded border border-border-subtle bg-canvas px-2 py-1">미변경 <strong>{root.counts.unchangedCount}</strong></div>
          </div>
        ) : null}
      </div>

      {hasUnavailableCopy ? (
        <p
          aria-live="polite"
          className="mb-3 rounded-md border border-warning bg-warning-surface px-3 py-2 text-xs text-warning"
          role="status"
        >
          {baselineUnavailableCopy}
        </p>
      ) : null}

      <section className="mb-3 rounded-md border border-border-subtle bg-surface p-2">
        <h3 className="font-semibold">필터</h3>
        <div className="mt-2 grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span>Layer</span>
            <input
              aria-label="layer 필터"
              className="rounded-md border border-border-subtle px-2 py-1"
              onChange={handleLayerKeyFilter}
              placeholder="예: L1::10::ETCH"
              type="text"
              value={filters.layerKey}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Category</span>
            <input
              aria-label="category 필터"
              className="rounded-md border border-border-subtle px-2 py-1"
              onChange={handleCategoryFilter}
              placeholder="예: process"
              type="text"
              value={filters.categoryCode}
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span>Parameter</span>
            <input
              aria-label="parameter 필터"
              className="rounded-md border border-border-subtle px-2 py-1"
              onChange={handleParameterFilter}
              placeholder="예: ETCH_P001"
              type="text"
              value={filters.parameterCode}
            />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">classification</span>
          {CLASSIFICATIONS.map((classification) => {
            const checked = selectedClassifications.has(classification)
            return (
              <label className="inline-flex items-center gap-1" key={classification}>
                <input
                  checked={checked}
                  onChange={(event) => handleClassificationToggle(classification, event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>{classification}</span>
              </label>
            )
          })}
          <label className="ml-auto inline-flex items-center gap-1 text-xs">
            <input
              checked={filters.includeUnchanged}
              onChange={(event) => handleIncludeUnchanged(event.currentTarget.checked)}
              type="checkbox"
            />
            unchanged 포함
          </label>
        </div>
      </section>

      <section className="mb-3 rounded-md border border-border-subtle bg-surface p-2">
        <h3 className="font-semibold">변경 미리보기 (최대 {previewCards.length > 0 ? previewCards.length : 20})</h3>
        {preview.status === 'loading' ? <LoadingMessage>미리보기 로드 중...</LoadingMessage> : null}
        {preview.status === 'error' && preview.error !== null && preview.items.length === 0 ? (
          <>
            <ErrorMessage message={preview.error} />
            <button
              className="mt-2 rounded-sm border border-brand-700 px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              onClick={onRetry}
              type="button"
            >
              미리보기 다시 시도
            </button>
          </>
        ) : null}
          {preview.status === 'ready' && preview.items.length === 0 ? (
          <p className="mt-2 text-xs text-muted">미리보기 항목이 없습니다.</p>
        ) : null}
        {preview.items.length > 0 ? (
          <ul className="mt-2 space-y-1 text-xs">
            {preview.items.map((item) => (
              <li
                key={
                  item.itemSortKey
                    .map((value) => String(value ?? ''))
                    .concat([
                      item.itemKind,
                      item.classification,
                      item.layerKey,
                      String(item.effectiveConditionIndex),
                      item.rowRef ?? '',
                      item.parameterCode ?? '',
                    ])
                    .join('::')
                }
                className="rounded border border-border-subtle bg-canvas px-2 py-1"
              >
                <p>
                  [{item.classification}] {item.itemKind} · {item.layerKey} · #{item.effectiveConditionIndex}
                </p>
                <p className="text-muted mt-1">
                  {item.rowStatus !== undefined && item.rowStatus !== null
                    ? `상태: ${item.rowStatus}`
                    : '상태: 미지정'}
                  {item.parameterCode !== undefined && item.parameterCode !== null
                    ? ` · 파라미터: ${item.parameterCode}`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        {preview.status === 'error' && preview.error !== null && preview.items.length > 0 ? (
          <>
            <ErrorMessage message={preview.error} />
            <button
              className="mt-2 rounded-sm border border-brand-700 px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              onClick={onRetry}
              type="button"
            >
              미리보기 다시 시도
            </button>
          </>
        ) : null}
        {preview.nextCursor !== null ? (
          <button
            className="mt-2 rounded-sm border border-brand-700 px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
            disabled={preview.status !== 'ready'}
            onClick={() => onLoadMorePreview(preview.nextCursor)}
            type="button"
          >
            더 보기
          </button>
        ) : null}
        {preview.nextPageError !== null ? (
          <p className="mt-2 text-xs text-warning" role="status">
            {preview.nextPageError}
          </p>
        ) : null}
      </section>

      <section className="rounded-md border border-border-subtle bg-surface p-2">
        <h3 className="font-semibold">레이어</h3>
        {root === null ? <p className="mt-2 text-xs text-muted">루트 데이터를 불러온 뒤 레이어를 조회할 수 있습니다.</p> : null}

        <div className="mt-2 space-y-2">
          {root?.layerSummaries.map((layer) => {
            const isExpanded = expandedLayerKey === layer.layerKey
            const branch = layerConditionBranches[layer.layerKey]
            const branchItems = branch?.items ?? []
            const branchStatus = branch?.status ?? 'idle'

            return (
              <article key={layer.layerKey} className="rounded-md border border-border-subtle bg-canvas p-2" data-layer={layer.layerKey}>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    aria-disabled={layer.layerStatus === 'unavailable' && !isExpanded}
                    className="rounded-sm border border-brand-700 px-2 py-1 text-xs font-semibold text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                    onClick={() => {
                      if (layer.layerStatus === 'available' || isExpanded) {
                        toggleLayer(layer.layerKey)
                      } else {
                        emitAnnouncement('현재 레이어는 목록을 조회할 수 없습니다.')
                      }
                    }}
                    type="button"
                  >
                    {isExpanded ? '접기' : layer.layerStatus === 'available' ? '열기' : '조회 불가'}
                  </button>
                  <strong className="max-w-full break-all text-xs">{layer.layerKey}</strong>
                  <span className="text-xs text-muted">변경 {layer.changedCount}</span>
                  <span className="text-xs text-muted">조건 {layer.currentConditionCount}/{layer.baselineConditionCount}</span>
                  <span className="text-xs text-muted">셀 {layer.cellCount}/{layer.fullCellCount}</span>
                  <span
                    className={cn(
                      'rounded border px-2 py-0.5 text-[11px]',
                      layer.layerStatus === 'available'
                        ? 'border-success text-success'
                        : 'border-warning text-warning',
                    )}
                  >
                    {layer.layerStatus}
                  </span>
                </div>

                {isExpanded ? (
                  <div className="mt-2 space-y-2">
                    {branchStatus === 'loading' ? <LoadingMessage>조건 목록 로드 중...</LoadingMessage> : null}
                    {branchStatus === 'error' && branch !== undefined ? (
                      <div className="rounded border border-error/40 bg-error/10 p-2 text-xs text-error-700">
                        <ErrorMessage message={branch.error ?? '조건 목록을 불러오지 못했습니다.'} />
                        <button
                          className="mt-1 rounded-sm border border-error px-2 py-1 font-semibold"
                          onClick={() => onRetryConditions(layer.layerKey)}
                          type="button"
                        >
                          조건 다시 시도
                        </button>
                      </div>
                    ) : null}
                    {branchItems.length === 0 && branchStatus === 'ready' ? (
                      <p className="text-xs text-muted">조건 항목이 없습니다.</p>
                    ) : null}

                    {branchItems.map((condition) => {
                      const isRowExpanded = expandedLayerKey === layer.layerKey && expandedRowRef === condition.rowRef
                      const cellBranch = cellBranches[condition.rowRef]
                      const cells = cellBranch?.items ?? []
                      const baselineConditionIndex = condition.baselineCondition?.conditionIndex
                      const currentConditionIndex = condition.currentCondition?.conditionIndex
                      const baselineLabel = formatNullableText(condition.baselineCondition?.label)
                      const currentLabel = formatNullableText(condition.currentCondition?.label)
                      const rowFacts = formatBackboneDiffConditionFacts({
                        rowStatus: condition.rowStatus,
                        baselineConditionLabel: baselineLabel,
                        currentConditionLabel: currentLabel,
                        baselineConditionIndex,
                        currentConditionIndex,
                        baselineConditionPor: condition.baselineCondition?.isPor,
                        currentConditionPor: condition.currentCondition?.isPor,
                        rowMetadata: condition.rowMetadata,
                      })
                      const hasConditionNavigation =
                        condition.cellScope !== null
                        && ((condition.currentCondition?.conditionId ?? null) !== null
                        || (condition.baselineCondition?.conditionId ?? null) !== null)

                      const isRowJumpAvailable = false

                      return (
                        <div key={condition.rowRef} className="rounded border border-border-subtle bg-surface p-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              className="rounded-sm border border-brand-700 px-2 py-1 text-xs font-semibold text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                              onClick={() => {
                                if (!hasConditionNavigation && !isRowExpanded) {
                                  emitAnnouncement('현재 위치로 이동할 수 없습니다.')
                                  return
                                }

                                toggleRow(condition.rowRef, hasConditionNavigation)
                              }}
                              type="button"
                              aria-disabled={!hasConditionNavigation && !isRowExpanded}
                            >
                              {isRowExpanded ? '셀 접기' : hasConditionNavigation ? '셀 보기' : '셀 조회 불가'}
                            </button>
                            <span className="text-muted">{rowFacts.baselineToCurrentLabel}</span>
                            <span className="max-w-full break-all">
                              condition #{condition.effectiveConditionIndex}
                              {' · '}조건 인덱스 {rowFacts.baselineToCurrentIndex}
                              {' · '}POR {rowFacts.baselineToCurrentPor}
                              {condition.filteredCellCount !== condition.fullCellCount
                                ? ` · ${condition.filteredCellCount} / ${condition.fullCellCount} 셀`
                                : ` · 셀 ${condition.fullCellCount}`}
                              {' · '}상태: {condition.rowStatus}
                            </span>
                            <button
                              className={cn(
                                'rounded-sm border px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700',
                                isRowJumpAvailable
                                  ? 'border-brand-700 text-brand-700'
                                  : 'border-border-subtle text-muted',
                              )}
                              aria-disabled={!isRowJumpAvailable}
                              onClick={() => {
                                emitAnnouncement('현재 위치로 이동할 수 없습니다.')
                                }}
                              type="button"
                            >
                              {renderActivationButtonText('unavailable')}
                            </button>
                          </div>

                          {isRowExpanded ? (
                            <div className="mt-2 space-y-1">
                              {cellBranch?.status === 'loading' ? <LoadingMessage>셀 목록 로드 중...</LoadingMessage> : null}
                              {cellBranch?.status === 'error' ? (
                                <div className="rounded border border-error/40 bg-error/10 p-2 text-xs text-error-700">
                                  <ErrorMessage message={cellBranch.error ?? '셀 목록을 불러오지 못했습니다.'} />
                                  <button
                                    className="mt-1 rounded-sm border border-error px-2 py-1 font-semibold"
                                    onClick={() => onRetryCells(condition.rowRef)}
                                    type="button"
                                  >
                                    셀 다시 시도
                                  </button>
                                </div>
                              ) : null}
                              {cells.length === 0 && cellBranch !== undefined ? <p className="text-xs text-muted">셀 항목이 없습니다.</p> : null}
                              {cells.length > 0 ? (
                                <ul className="space-y-1">
                                  {cells.map((cell) => {
                                    const cellActivation = activationStatusFor({
                                      classification: cell.classification,
                                      jumpStatus: cell.jumpStatus,
                                    })
                                    return (
                                      <li key={cell.parameterCode} className="rounded-sm border border-border-subtle px-2 py-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span>
                                            {cell.parameterCode} ({cell.classification})
                                          </span>
                                          <button
                                            className={cn(
                                              'rounded-sm border px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700',
                                              cellActivation === 'available'
                                                ? 'border-brand-700 text-brand-700'
                                                : 'border-border-subtle text-muted',
                                            )}
                                            aria-disabled={cellActivation !== 'available'}
                                            onClick={() => {
                                              if (cellActivation !== 'available') {
                                                if (cellActivation === 'removed') {
                                                  emitAnnouncement('삭제된 대상은 이동할 수 없습니다.')
                                                } else if (cellActivation === 'deleted') {
                                                  emitAnnouncement('삭제된 대상으로는 위치를 이동할 수 없습니다.')
                                                } else {
                                                  emitAnnouncement('현재 위치로 이동할 수 없습니다.')
                                                }
                                                return
                                              }

                                              activateTarget({
                                                kind: 'cell',
                                                layerKey: layer.layerKey,
                                                classification: cell.classification,
                                                jumpStatus: cell.jumpStatus,
                                                rowRef: condition.rowRef,
                                                conditionId: condition.identity,
                                                parameterCode: cell.parameterCode,
                                                sourceConditionId:
                                                  condition.currentCondition?.sourceConditionId
                                                  ?? condition.baselineCondition?.sourceConditionId
                                                  ?? null,
                                              })
                                            }}
                                            type="button"
                                          >
                                            {renderActivationButtonText(cellActivation)}
                                          </button>
                                          <span className="text-muted">
                                            {cell.baselineValue ?? '기준 없음'} → {cell.currentValue ?? '현재 없음'}
                                          </span>
                                          <span className="text-muted">{cell.reason}</span>
                                        </div>
                                      </li>
                                    )
                                  })}
                                </ul>
                              ) : null}
                              {cellBranch !== undefined && cellBranch.nextCursor !== null && cellBranch.status === 'ready' ? (
                                <button
                                  className="rounded-sm border border-brand-700 px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                                  onClick={() => onLoadMoreCells(condition.rowRef, cellBranch.nextCursor)}
                                  type="button"
                                >
                                  더 보기
                                </button>
                              ) : null}
                              {cellBranch?.nextPageError !== null ? (
                                <p className="text-xs text-warning">{cellBranch.nextPageError}</p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}

                    {branch !== undefined && branch.nextCursor !== null ? (
                      <button
                        className="rounded-sm border border-brand-700 px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                        disabled={branchStatus !== 'ready'}
                        onClick={() => onLoadMoreConditions(layer.layerKey, branch.nextCursor)}
                        type="button"
                      >
                        더 보기
                      </button>
                    ) : null}
                    {branch?.nextPageError !== null ? <p className="text-xs text-warning">{branch.nextPageError}</p> : null}
                  </div>
                ) : null}
              </article>
            )
          })}

          {root !== null && root.layerSummaries.length === 0 ? (
            <p className="text-xs text-muted">변경된 레이어가 없습니다.</p>
          ) : null}
        </div>
      </section>

      {hasRefreshAnnouncement ? (
        <p aria-live="polite" className="mt-2 text-xs text-muted" role="status">
          {refreshAnnouncement}
        </p>
      ) : null}
      {announcement !== null ? (
        <p aria-live="polite" className="mt-2 text-xs text-muted" role="status">
          {announcement}
        </p>
      ) : null}
    </section>
  )
}

export function activateBackboneJumpTarget(
  target: BackboneDiffJumpTarget,
  onActivateTarget: (target: BackboneDiffJumpTarget) => void,
): boolean {
  if (target.classification === 'removed') {
    return false
  }
  if (target.jumpStatus === 'deleted') {
    return false
  }
  if (target.parameterCode === null) {
    return false
  }
  onActivateTarget(target)
  return true
}

function activationStatusFor({
  classification,
  jumpStatus,
  hasNavigation,
}: {
  classification: BackboneDiffClassification | BackboneDiffRowStatus
  jumpStatus: BackboneDiffJumpStatus
  hasNavigation?: boolean
}): BackboneDiffActivationStatus {
  if (hasNavigation === false) return 'unavailable'
  if (classification === 'removed') return 'removed'
  if (jumpStatus === 'deleted') return 'deleted'
  return 'available'
}
