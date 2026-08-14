import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'

import type {
  HistoryCellHistoryItemOut,
  HistoryCellHistoryOut,
  HistoryCoverageOut,
  HistoryDetailOut,
  HistoryJumpTargetOut,
  HistoryTimelineItemOut,
} from '@/api/history'
import type { HistoryTimelineFilterInput, HistoryTimelineFilters } from '@/api/historyQuery'
import { cn } from '@/shared/lib/cn'

import {
  buildHistoryCellActivationTarget,
  buildHistoryDetailActivationTarget,
  describeHistoryDetailStatus,
  describeHistoryJumpTarget,
  describeHistoryLegacyCoverage,
  getHistoryTimelineItemKey,
  getHistoryDetailItemKey,
  historyEventTypeLabel,
  HISTORY_EVENT_TYPES,
  createHistoryWorkbenchState,
  normalizeHistoryWorkbenchFilters,
  resolveHistoryActorLabel,
  shouldRequestHistoryBatchDetailOnOpen,
  type HistoryWorkbenchMode,
  type HistoryWorkbenchState,
} from './historyWorkbenchState'

export interface HistoryWorkbenchProps {
  projectId: number
  state: HistoryWorkbenchState
  coverage: HistoryCoverageOut
  cellHistory?: HistoryCellHistoryOut | null
  timelineStatus?: 'idle' | 'loading' | 'ready' | 'error'
  timelineError?: string | null
  nextPageError?: string | null
  cellStatus?: 'idle' | 'loading' | 'ready' | 'error'
  cellError?: string | null
  cellNextPageError?: string | null
  batchDetailStatus?: 'idle' | 'loading' | 'ready' | 'error'
  batchDetailError?: string | null
  batchDetailIsFetchingNextPage?: boolean
  batchDetailNextPageError?: string | null
  navigationStatus?: string | null
  onFiltersChange?: (filters: HistoryTimelineFilterInput) => void
  onModeChange?: (mode: HistoryWorkbenchMode) => void
  onBatchToggle?: (item: HistoryTimelineItemOut, shouldRequestDetail: boolean) => void
  onRetryBatchDetail?: (item: HistoryTimelineItemOut) => void
  onLoadMoreBatchDetail?: (item: HistoryTimelineItemOut, cursor: string | null) => void
  onActivateTarget?: (target: HistoryJumpTargetOut) => void
  onLoadMoreTimeline?: (cursor: string | null) => void
  onLoadMoreCell?: (cursor: string | null) => void
  onRetryTimeline?: () => void
  onRetryCell?: () => void
}

const HISTORY_ORIGIN_OPTIONS = ['manual', 'paste', 'backbone', 'system'] as const

function describeHistoryOrigin(origin: HistoryTimelineFilters['origin']): string {
  switch (origin) {
    case 'manual':
      return '직접 입력'
    case 'paste':
      return '붙여넣기'
    case 'backbone':
      return '백본'
    case 'system':
      return '시스템'
    default:
      return '전체 변경'
  }
}

export function describeHistoryFilters(filters: HistoryTimelineFilters): string {
  const summary = [describeHistoryOrigin(filters.origin)]
  if (filters.eventTypes.length > 0) {
    summary.push(`변경 유형 ${filters.eventTypes.length}개`)
  }
  summary.push(filters.actor ?? '전체 작업자')
  return summary.join(' · ')
}

export type HistoryFilterDraftValidation =
  | { readonly ok: true; readonly filters: HistoryTimelineFilters }
  | { readonly ok: false; readonly message: string }

export function validateHistoryWorkbenchFilterDraft(
  draft: HistoryTimelineFilterInput,
  sourceProjectIdText: string,
): HistoryFilterDraftValidation {
  const sourceText = sourceProjectIdText.trim()
  const sourceProjectId = parsePositiveIntegerText(sourceText)
  if (sourceText !== '' && sourceProjectId === null) {
    return { ok: false, message: 'Source project는 1 이상의 정수로 입력해 주세요.' }
  }
  try {
    return {
      ok: true,
      filters: normalizeHistoryWorkbenchFilters({ ...draft, sourceProjectId }),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (
      message.includes('createdFrom') ||
      message.includes('createdTo') ||
      message.includes('earlier than')
    ) {
      return { ok: false, message: '기간은 유효한 ISO 날짜/시간으로 입력해 주세요.' }
    }
    return { ok: false, message: '필터 값을 확인해 주세요.' }
  }
}

export function applyHistoryWorkbenchFilterDraft(
  draft: HistoryTimelineFilterInput,
  sourceProjectIdText: string,
  onApply: (filters: HistoryTimelineFilters) => void,
): string | null {
  const result = validateHistoryWorkbenchFilterDraft(draft, sourceProjectIdText)
  if (!result.ok) return result.message
  onApply(result.filters)
  return null
}

export function HistoryWorkbench({
  projectId,
  state,
  coverage,
  cellHistory = null,
  timelineStatus = 'ready',
  timelineError = null,
  nextPageError = null,
  cellStatus = 'ready',
  cellError = null,
  cellNextPageError = null,
  batchDetailStatus = 'idle',
  batchDetailError = null,
  batchDetailIsFetchingNextPage = false,
  batchDetailNextPageError = null,
  navigationStatus = null,
  onFiltersChange,
  onModeChange,
  onBatchToggle,
  onRetryBatchDetail,
  onLoadMoreBatchDetail,
  onActivateTarget,
  onLoadMoreTimeline,
  onLoadMoreCell,
  onRetryTimeline,
  onRetryCell,
}: HistoryWorkbenchProps) {
  const timelineItems = useMemo(() => state.pages.flatMap((page) => page.items), [state.pages])
  const legacyCoverageMessage = describeHistoryLegacyCoverage(coverage)
  const hasTimelineRows = timelineItems.length > 0
  const hasTimelineError = timelineError !== null && timelineError.trim() !== ''
  const hasNextPageError = nextPageError !== null && nextPageError.trim() !== ''
  const hasCellError = cellError !== null && cellError.trim() !== ''
  const hasCellNextPageError = cellNextPageError !== null && cellNextPageError.trim() !== ''
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const [draft, setDraft] = useState<HistoryTimelineFilters>(
    createHistoryWorkbenchState(state.filters).filters,
  )
  const [draftSourceProjectIdText, setDraftSourceProjectIdText] = useState(
    state.filters.sourceProjectId === null ? '' : String(state.filters.sourceProjectId),
  )
  const [filterError, setFilterError] = useState<string | null>(null)
  const [filtersExpanded, setFiltersExpanded] = useState(false)

  useEffect(() => {
    setDraft(createHistoryWorkbenchState(state.filters).filters)
    setDraftSourceProjectIdText(
      state.filters.sourceProjectId === null ? '' : String(state.filters.sourceProjectId),
    )
    setFilterError(null)
  }, [state.filters, state.revision])

  function emitAnnouncement(message: string | null): void {
    setAnnouncement(message)
  }

  function handleApplyFilters(): void {
    const layerKey = state.filters.layerKey
    setFilterError(
      applyHistoryWorkbenchFilterDraft(draft, draftSourceProjectIdText, (filters) => {
        onFiltersChange?.({ ...filters, layerKey })
      }),
    )
  }

  function handleResetFilters(): void {
    const layerKey = state.filters.layerKey
    const reset = normalizeHistoryWorkbenchFilters({ layerKey })
    setDraft(createHistoryWorkbenchState({ layerKey }).filters)
    setDraftSourceProjectIdText('')
    setFilterError(null)
    onFiltersChange?.(reset)
  }

  function handleModeChange(mode: HistoryWorkbenchMode): void {
    onModeChange?.(mode)
  }

  function handleLoadMoreTimeline(): void {
    onLoadMoreTimeline?.(state.nextCursor)
  }

  function handleLoadMoreCell(): void {
    onLoadMoreCell?.(cellHistory?.next_cursor ?? null)
  }

  function updateDraftField<K extends keyof HistoryTimelineFilters>(
    key: K,
    value: HistoryTimelineFilters[K],
  ): void {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function handleCreatedFromChange(event: ChangeEvent<HTMLInputElement>): void {
    updateDraftField('createdFrom', event.currentTarget.value || null)
  }

  function handleCreatedToChange(event: ChangeEvent<HTMLInputElement>): void {
    updateDraftField('createdTo', event.currentTarget.value || null)
  }

  function handleActorChange(event: ChangeEvent<HTMLInputElement>): void {
    updateDraftField('actor', event.currentTarget.value || null)
  }

  function handleOriginChange(event: ChangeEvent<HTMLSelectElement>): void {
    updateDraftField(
      'origin',
      event.currentTarget.value === ''
        ? null
        : (event.currentTarget.value as HistoryTimelineFilters['origin']),
    )
  }

  function handleSourceProjectIdTextChange(event: ChangeEvent<HTMLInputElement>): void {
    setDraftSourceProjectIdText(event.currentTarget.value)
  }

  function handleToggleEventType(eventType: (typeof HISTORY_EVENT_TYPES)[number], checked: boolean): void {
    updateDraftField(
      'eventTypes',
      checked
        ? [...draft.eventTypes, eventType]
        : draft.eventTypes.filter((value) => value !== eventType),
    )
  }

  function renderTimelineItem(item: HistoryTimelineItemOut): ReactNode {
    const itemKey = getHistoryTimelineItemKey(item)
    const isExpanded = state.expandedBatchKey === itemKey
    const detail = state.batchDetailCache[itemKey]
    const detailUnavailableCopy = describeHistoryDetailStatus(item)
    const targetUnavailableCopy = describeHistoryJumpTarget(item.jump_target)
    const canToggleBatch = item.kind === 'batch' && item.detail_status === 'available'
    const shouldRequestDetail = !isExpanded && shouldRequestHistoryBatchDetailOnOpen(state, item)
    const actorLabel = resolveHistoryActorLabel(item.actors)
    const jumpTarget = item.jump_target

    function handleToggleBatch(): void {
      if (!canToggleBatch) return
      onBatchToggle?.(item, shouldRequestDetail)
    }

    function handleJumpTargetActivate(): void {
      if (jumpTarget === null) return
      if (jumpTarget.jump_status === 'available') {
        emitAnnouncement(null)
        onActivateTarget?.(jumpTarget)
        return
      }
      emitAnnouncement('삭제된 대상이라 위치로 이동할 수 없습니다.')
    }

    return (
      <article
        key={itemKey}
        className="rounded-md border border-border-subtle bg-surface p-3 text-sm"
        data-history-item
        data-history-item-key={itemKey}
      >
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="truncate font-semibold text-foreground">{item.summary}</h4>
            <p className="mt-1 text-xs text-muted">
              {item.started_at} · {actorLabel} · {item.origins.join(', ')} · {item.event_types.join(', ')}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 text-xs text-muted">
            <span>총 {item.total_event_count}</span>
            <span>일치 {item.matched_event_count}</span>
            <span>{item.metadata_status === 'legacy_partial' ? '레거시 일부' : '완전'}</span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          {item.layer_keys.length > 0 ? <span>Layer {item.layer_keys.join(', ')}</span> : null}
          {item.source_project_id !== null ? <span>source #{item.source_project_id}</span> : null}
          {item.batch_id !== null ? <span>batch {item.batch_id}</span> : null}
        </div>

        {jumpTarget !== null ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              className={cn(
                'rounded-sm border px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700',
                jumpTarget.jump_status === 'deleted'
                  ? 'border-border-subtle text-muted'
                  : 'border-brand-700 text-brand-700',
              )}
              onClick={handleJumpTargetActivate}
              type="button"
            >
              {jumpTarget.jump_status === 'deleted' ? '삭제됨' : '위치로 이동'}
            </button>
            {targetUnavailableCopy !== null ? (
              <span aria-live="polite" className="text-xs text-muted" role="status">
                {targetUnavailableCopy}
              </span>
            ) : null}
          </div>
        ) : null}

        {item.kind === 'batch' ? (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {canToggleBatch ? (
                <button
                  className="rounded-sm border border-border-subtle px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                  onClick={handleToggleBatch}
                  type="button"
                >
                  {isExpanded ? '상세 접기' : '상세 보기'}
                </button>
              ) : (
                <span className="rounded-sm border border-border-subtle px-2 py-1 text-xs text-muted">
                  상세 미지원
                </span>
              )}
              <span className="text-xs text-muted">
                {item.detail_status === 'legacy_unavailable'
                  ? '레거시 배치라 상세를 불러올 수 없습니다.'
                  : item.detail_status === 'not_applicable'
                    ? '상세 이력이 없는 요약입니다.'
                    : '요약만 먼저 렌더됩니다.'}
              </span>
            </div>

            {detailUnavailableCopy !== null ? (
              <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning-700">
                {detailUnavailableCopy}
              </p>
            ) : null}

            {isExpanded ? (
              detail !== undefined ? (
                <HistoryBatchDetailList
                  detail={detail}
                  isFetchingNextPage={batchDetailIsFetchingNextPage}
                  item={item}
                  nextPageError={batchDetailNextPageError}
                  onActivateTarget={onActivateTarget}
                  onAnnouncement={emitAnnouncement}
                  onLoadMore={onLoadMoreBatchDetail}
                />
              ) : batchDetailStatus === 'error' ? (
                <div
                  className="rounded-md border border-error/40 bg-error/10 p-2 text-xs text-error-700"
                  role="alert"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{batchDetailError ?? '상세 이력을 불러오지 못했습니다.'}</span>
                    {onRetryBatchDetail !== undefined ? (
                      <button
                        className="rounded-sm border border-error/30 px-2 py-1 font-semibold"
                        onClick={() => onRetryBatchDetail(item)}
                        type="button"
                      >
                        상세 다시 시도
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : batchDetailStatus === 'loading' ? (
                <p className="rounded-md border border-border-subtle bg-canvas p-2 text-xs text-muted">
                  상세 이력을 불러오는 중입니다.
                </p>
              ) : canToggleBatch ? (
                <p className="rounded-md border border-border-subtle bg-canvas p-2 text-xs text-muted">
                  상세 이력을 아직 불러오지 않았습니다.
                </p>
              ) : null
            ) : null}
          </div>
        ) : null}
      </article>
    )
  }

  function renderCellHistoryItem(item: HistoryCellHistoryItemOut): ReactNode {
    const target = state.cellScope === null ? null : buildHistoryCellActivationTarget(state.cellScope, item)
    function handleActivate(): void {
      if (target === null) return
      if (target.jump_status === 'available') {
        emitAnnouncement(null)
        onActivateTarget?.(target)
        return
      }
      emitAnnouncement('삭제된 대상이라 위치로 이동할 수 없습니다.')
    }

    return (
      <article key={item.event_id} className="rounded-md border border-border-subtle bg-surface p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-muted">
          <strong className="text-foreground">{item.created_at}</strong>
          <span>{resolveHistoryActorLabel(item.actor === null ? [] : [item.actor])}</span>
          <span>{item.origin}</span>
          <span>{item.layer_key ?? 'layer 없음'}</span>
        </div>
        <p className="mt-1 text-muted">
          {item.old_code ?? '—'} → {item.new_code ?? '—'}
          {item.choice_label !== null ? ` · ${item.choice_label}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            className={cn(
              'rounded-sm border px-2 py-1 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700',
              item.jump_status === 'deleted'
                ? 'border-border-subtle text-muted'
                : 'border-brand-700 text-brand-700',
            )}
            onClick={handleActivate}
            type="button"
            >
              {item.jump_status === 'deleted' ? '삭제됨' : '위치로 이동'}
            </button>
          {item.jump_status === 'deleted' ? (
            <span aria-live="polite" className="text-xs text-muted" role="status">
              삭제된 대상이라 위치로 이동할 수 없습니다.
            </span>
          ) : null}
        </div>
      </article>
    )
  }

  return (
    <section
      aria-label="변경 이력 워크벤치"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-border-subtle bg-surface"
      data-history-workbench
      data-project-id={projectId}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2 text-sm">
        <strong className="text-foreground">변경 이력</strong>
        <span className="text-xs text-muted">프로젝트 #{projectId}</span>
        <div className="ml-auto flex gap-2">
          <button
            aria-pressed={state.mode === 'timeline'}
            className={modeButtonClass(state.mode === 'timeline')}
            onClick={() => handleModeChange('timeline')}
            type="button"
          >
            타임라인
          </button>
          <button
            aria-pressed={state.mode === 'cell'}
            className={modeButtonClass(state.mode === 'cell')}
            onClick={() => handleModeChange('cell')}
            type="button"
          >
            셀 이력
          </button>
        </div>
      </div>

      <p aria-live="polite" aria-atomic="true" className="sr-only" role="status">
        {announcement ?? navigationStatus ?? ''}
      </p>

      {legacyCoverageMessage !== null ? (
        <div
          aria-live="polite"
          className="border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-700"
          role="status"
        >
          {legacyCoverageMessage}
        </div>
      ) : null}

      {state.mode === 'timeline' ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
          <div className="rounded-md border border-border-subtle bg-canvas text-xs">
            <button
              aria-controls="history-filter-panel"
              aria-expanded={filtersExpanded}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              onClick={() => setFiltersExpanded((open) => !open)}
              type="button"
            >
              <span>{describeHistoryFilters(state.filters)}</span>
              <span aria-hidden="true">{filtersExpanded ? '접기' : '필터'}</span>
            </button>
          </div>

          {filtersExpanded ? (
            <form
              aria-label="이력 필터"
              className="grid gap-3 rounded-md border border-border-subtle bg-canvas p-3 text-xs"
              id="history-filter-panel"
            >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="flex flex-col gap-1">
                <span>기간 시작</span>
                <input
                  className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-sm"
                  onChange={handleCreatedFromChange}
                  value={draft.createdFrom ?? ''}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span>기간 종료</span>
                <input
                  className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-sm"
                  onChange={handleCreatedToChange}
                  value={draft.createdTo ?? ''}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span>작업자</span>
                <input
                  className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-sm"
                  onChange={handleActorChange}
                  value={draft.actor ?? ''}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span>입력 방식</span>
                <select
                  className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-sm"
                  onChange={handleOriginChange}
                  value={draft.origin ?? ''}
                >
                  <option value="">전체</option>
                  {HISTORY_ORIGIN_OPTIONS.map((origin) => (
                    <option key={origin} value={origin}>
                      {origin}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span>Source project</span>
                <input
                  className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-sm"
                  inputMode="numeric"
                  onChange={handleSourceProjectIdTextChange}
                  value={draftSourceProjectIdText}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="shrink-0 text-muted">변경 유형</span>
              {HISTORY_EVENT_TYPES.map((eventType) => (
                <label key={eventType} className="inline-flex items-center gap-1 rounded-sm border border-border-subtle px-2 py-1 text-xs">
                  <input
                    checked={draft.eventTypes.includes(eventType)}
                    onChange={(event) => handleToggleEventType(eventType, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span>{historyEventTypeLabel(eventType)}</span>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-sm border border-border-subtle px-3 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                onClick={handleApplyFilters}
                type="button"
              >
                적용
              </button>
              <button
                className="rounded-sm border border-border-subtle px-3 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                onClick={handleResetFilters}
                type="button"
              >
                초기화
              </button>
              <span className="text-xs text-muted">
                {timelineItems.length}개 항목 · {state.nextCursor === null ? '마지막 페이지' : '다음 페이지 있음'}
              </span>
            </div>
            {filterError !== null ? (
              <p
                className="rounded-sm border border-error/40 bg-error/10 px-2 py-1 text-error-700"
                role="alert"
              >
                {filterError}
              </p>
            ) : null}
            </form>
          ) : null}

          {timelineStatus === 'loading' ? (
            <div aria-live="polite" className="rounded-md border border-border-subtle bg-canvas p-3 text-sm text-muted" role="status">
              이력을 불러오는 중입니다.
            </div>
          ) : null}

          {hasTimelineError ? (
            <div className="rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error-700" role="alert">
              <div className="flex flex-wrap items-center gap-2">
                <span>{timelineError}</span>
                {onRetryTimeline !== undefined ? (
                  <button
                    className="rounded-sm border border-error/30 px-2 py-1 text-xs font-semibold"
                    onClick={onRetryTimeline}
                    type="button"
                  >
                    다시 시도
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {hasTimelineRows ? (
            <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto">
              {timelineItems.map((item) => renderTimelineItem(item))}
            </div>
          ) : hasTimelineError || timelineStatus === 'loading' ? null : (
            <div className="rounded-md border border-border-subtle bg-canvas p-3 text-sm text-muted">
              표시할 변경 이력이 없습니다.
            </div>
          )}

          {hasNextPageError ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-700" role="status">
              <div className="flex flex-wrap items-center gap-2">
                <span>{nextPageError}</span>
                {state.nextCursor !== null && onLoadMoreTimeline !== undefined ? (
                  <button
                    className="rounded-sm border border-warning/30 px-2 py-1 text-xs font-semibold"
                    onClick={handleLoadMoreTimeline}
                    type="button"
                  >
                    다음 페이지 다시 시도
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {state.nextCursor !== null ? (
            <div className="flex justify-center">
              <button
                className="rounded-sm border border-border-subtle px-3 py-1 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                onClick={handleLoadMoreTimeline}
                type="button"
              >
                다음 페이지 불러오기
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
          {state.cellScope === null ? (
            <div className="rounded-md border border-border-subtle bg-canvas p-3 text-sm text-muted">
              셀 이력이 선택되지 않았습니다.
            </div>
          ) : (
            <div className="rounded-md border border-border-subtle bg-canvas p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <strong>셀 범위</strong>
                <span>condition #{state.cellScope.conditionId}</span>
                <span>parameter {state.cellScope.parameterCode}</span>
                {onModeChange !== undefined ? (
                  <button
                    className="ml-auto rounded-sm border border-border-subtle px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                    onClick={() => handleModeChange('timeline')}
                    type="button"
                  >
                    타임라인으로 돌아가기
                  </button>
                ) : null}
              </div>
            </div>
          )}

          {cellStatus === 'loading' ? (
            <div aria-live="polite" className="rounded-md border border-border-subtle bg-canvas p-3 text-sm text-muted" role="status">
              셀 이력을 불러오는 중입니다.
            </div>
          ) : null}

          {hasCellError ? (
            <div className="rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error-700" role="alert">
              <div className="flex flex-wrap items-center gap-2">
                <span>{cellError}</span>
                {onRetryCell !== undefined ? (
                  <button
                    className="rounded-sm border border-error/30 px-2 py-1 text-xs font-semibold"
                    onClick={onRetryCell}
                    type="button"
                  >
                    다시 시도
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {cellHistory !== null ? (
            <div className="space-y-3">
              <div className="rounded-md border border-border-subtle bg-surface p-3 text-sm">
                <h4 className="font-semibold text-foreground">초기 상태</h4>
                <p className="mt-1 text-xs text-muted">
                  {cellHistory.baseline_entry === null
                    ? '기준 셀이 없는 초기 상태입니다.'
                    : `기준 셀 ${cellHistory.baseline_entry.label ?? cellHistory.baseline_entry.code}`}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {cellHistory.initial_entry === null
                    ? '초기 항목이 없습니다.'
                    : `초기 항목 ${cellHistory.initial_entry.label ?? cellHistory.initial_entry.code}`}
                </p>
                {cellHistory.initial_state_unavailable ? (
                  <p className="mt-2 rounded-sm border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning-700">
                    초기 셀 상태를 확인할 수 없습니다.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">{cellHistory.items.map((item) => renderCellHistoryItem(item))}</div>

              {hasCellNextPageError ? (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-700" role="status">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{cellNextPageError}</span>
                    {cellHistory.next_cursor !== null && onLoadMoreCell !== undefined ? (
                      <button
                        className="rounded-sm border border-warning/30 px-2 py-1 text-xs font-semibold"
                        onClick={handleLoadMoreCell}
                        type="button"
                      >
                        더 보기 다시 시도
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {cellHistory.next_cursor !== null ? (
                <div className="flex justify-center">
                  <button
                    className="rounded-sm border border-border-subtle px-3 py-1 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                    onClick={handleLoadMoreCell}
                    type="button"
                  >
                    더 보기
                  </button>
                </div>
              ) : null}
            </div>
          ) : hasCellError || cellStatus === 'loading' ? null : (
            <div className="rounded-md border border-border-subtle bg-canvas p-3 text-sm text-muted">
              표시할 셀 이력이 없습니다.
            </div>
          )}
        </div>
      )}
    </section>
  )
}

interface HistoryBatchDetailListProps {
  readonly detail: HistoryDetailOut
  readonly isFetchingNextPage: boolean
  readonly item: HistoryTimelineItemOut
  readonly nextPageError: string | null
  readonly onActivateTarget?: (target: HistoryJumpTargetOut) => void
  readonly onAnnouncement: (message: string | null) => void
  readonly onLoadMore?: (item: HistoryTimelineItemOut, cursor: string | null) => void
}

export function activateHistoryDetailTarget(
  target: HistoryJumpTargetOut,
  onActivateTarget?: (target: HistoryJumpTargetOut) => void,
): boolean {
  if (target.jump_status !== 'available') return false
  onActivateTarget?.(target)
  return true
}

function HistoryBatchDetailList({
  detail,
  isFetchingNextPage,
  item,
  nextPageError,
  onActivateTarget,
  onAnnouncement,
  onLoadMore,
}: HistoryBatchDetailListProps) {
  function handleLoadMore(): void {
    onLoadMore?.(item, detail.next_cursor)
  }

  return (
    <div className="rounded-md border border-border-subtle bg-canvas p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-muted">
        <strong className="text-foreground">상세</strong>
        <span>{detail.order_kind}</span>
        <span>{detail.detail_status}</span>
        {detail.reason !== null ? <span>{detail.reason}</span> : null}
      </div>
      {detail.items.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {detail.items.map((entry) => {
            const target = buildHistoryDetailActivationTarget(entry)
            const isDeleted = target?.jump_status === 'deleted'

            function handleActivate(): void {
              if (target === null) return
              if (activateHistoryDetailTarget(target, onActivateTarget)) {
                onAnnouncement(null)
                return
              }
              onAnnouncement('삭제된 대상이라 위치로 이동할 수 없습니다.')
            }

            return (
              <li
                key={getHistoryDetailItemKey(entry)}
                className="rounded-sm border border-border-subtle bg-surface p-2"
              >
                <p className="font-semibold text-foreground">
                  {entry.created_at} · {resolveHistoryActorLabel(entry.actor === null ? [] : [entry.actor])}
                </p>
                <p className="mt-1 text-muted">
                  {entry.origin} · {entry.old_code ?? '—'} → {entry.new_code ?? '—'}
                  {entry.copied_value !== null ? ` · copied ${entry.copied_value}` : ''}
                </p>
                {entry.domain_coordinate !== null ? (
                  <p className="mt-1 text-muted">
                    {entry.domain_coordinate.layer_key}
                    {entry.domain_coordinate.condition_id !== null ? ` / ${entry.domain_coordinate.condition_id}` : ''}
                    {entry.domain_coordinate.parameter_code !== null ? ` / ${entry.domain_coordinate.parameter_code}` : ''}
                  </p>
                ) : null}
                {target !== null ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      className={cn(
                        'rounded-sm border px-2 py-1 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed',
                        isDeleted
                          ? 'border-border-subtle text-muted'
                          : 'border-brand-700 text-brand-700',
                      )}
                      disabled={isDeleted}
                      onClick={handleActivate}
                      type="button"
                    >
                      {isDeleted ? '삭제됨' : '상세 셀로 이동'}
                    </button>
                    {isDeleted ? (
                      <span aria-live="polite" className="text-xs text-muted" role="status">
                        삭제된 대상이라 위치로 이동할 수 없습니다.
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-2 text-muted">상세 항목이 없습니다.</p>
      )}
      {detail.next_cursor !== null ? (
        nextPageError !== null ? (
          <div
            className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-warning-700"
            role="status"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span>{nextPageError}</span>
              {onLoadMore !== undefined ? (
                <button
                  className="rounded-sm border border-warning/30 px-2 py-1 font-semibold"
                  onClick={handleLoadMore}
                  type="button"
                >
                  상세 다음 페이지 다시 시도
                </button>
              ) : null}
            </div>
          </div>
        ) : onLoadMore !== undefined ? (
          <div className="mt-3 flex justify-center">
            <button
              className="rounded-sm border border-border-subtle px-3 py-1 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-wait"
              disabled={isFetchingNextPage}
              onClick={handleLoadMore}
              type="button"
            >
              {isFetchingNextPage ? '상세 다음 페이지를 불러오는 중입니다.' : '상세 더 불러오기'}
            </button>
          </div>
        ) : null
      ) : null}
    </div>
  )
}

function modeButtonClass(selected: boolean): string {
  return cn(
    'rounded-sm border px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700',
    selected
      ? 'border-brand-700 bg-brand-700 text-white'
      : 'border-border-subtle bg-surface text-foreground',
  )
}

function parsePositiveIntegerText(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (!/^[1-9]\d*$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : null
}
