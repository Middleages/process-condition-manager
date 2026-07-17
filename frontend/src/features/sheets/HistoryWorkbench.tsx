import {
  useMemo,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import type {
  HistoryCellHistoryItemOut,
  HistoryCellHistoryOut,
  HistoryCoverageOut,
  HistoryDetailItemOut,
  HistoryDetailOut,
  HistoryJumpTargetOut,
  HistoryTimelineItemOut,
} from '@/api/history'
import type { HistoryTimelineFilterInput } from '@/api/historyQuery'
import { cn } from '@/shared/lib/cn'

import {
  describeHistoryDetailStatus,
  describeHistoryJumpTarget,
  describeHistoryLegacyCoverage,
  getHistoryTimelineItemKey,
  handleHistoryWorkbenchItemActivationKey,
  normalizeHistoryWorkbenchFilters,
  resolveHistoryActorLabel,
  shouldRequestHistoryBatchDetail,
  type HistoryCellScope,
  type HistoryWorkbenchMode,
  type HistoryWorkbenchState,
} from './historyWorkbenchState'

export interface HistoryWorkbenchProps {
  projectId: number
  state: HistoryWorkbenchState
  coverage: HistoryCoverageOut
  detailByBatchKey?: Readonly<Record<string, HistoryDetailOut>>
  cellHistory?: HistoryCellHistoryOut | null
  timelineStatus?: 'idle' | 'loading' | 'ready' | 'error'
  timelineError?: string | null
  nextPageError?: string | null
  cellStatus?: 'idle' | 'loading' | 'ready' | 'error'
  cellError?: string | null
  onFiltersChange?: (filters: HistoryTimelineFilterInput) => void
  onModeChange?: (mode: HistoryWorkbenchMode) => void
  onBatchToggle?: (item: HistoryTimelineItemOut, shouldRequestDetail: boolean) => void
  onActivateTarget?: (target: HistoryJumpTargetOut) => void
  onLoadMore?: (cursor: string | null) => void
  onRetry?: () => void
}

const HISTORY_ORIGIN_OPTIONS = ['manual', 'paste', 'backbone', 'system'] as const

const HISTORY_EVENT_TYPE_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: 'project_create', label: '프로젝트 생성' },
  { value: 'project_profile_update', label: '프로젝트 정보 변경' },
  { value: 'backbone_copy', label: 'backbone 복사' },
  { value: 'backbone_layer_replace', label: 'backbone 레이어 교체' },
  { value: 'cell_update', label: '셀 수정' },
  { value: 'condition_add', label: '조건 추가' },
  { value: 'condition_remove', label: '조건 삭제' },
  { value: 'por_change', label: 'POR 변경' },
]

export function HistoryWorkbench({
  projectId,
  state,
  coverage,
  detailByBatchKey = {},
  cellHistory = null,
  timelineStatus = 'ready',
  timelineError = null,
  nextPageError = null,
  cellStatus = 'ready',
  cellError = null,
  onFiltersChange,
  onModeChange,
  onBatchToggle,
  onActivateTarget,
  onRequestCellHistory,
  onLoadMore,
  onRetry,
}: HistoryWorkbenchProps) {
  const timelineItems = useMemo(() => state.pages.flatMap((page) => page.items), [state.pages])
  const legacyCoverageMessage = describeHistoryLegacyCoverage(coverage)
  const hasTimelineRows = timelineItems.length > 0
  const hasTimelineError = timelineError !== null && timelineError.trim() !== ''
  const hasNextPageError = nextPageError !== null && nextPageError.trim() !== ''
  const hasCellError = cellError !== null && cellError.trim() !== ''

  function emitFilters(nextFilters: HistoryTimelineFilterInput): void {
    onFiltersChange?.(normalizeHistoryWorkbenchFilters(nextFilters))
  }

  function handleCreatedFromChange(event: ChangeEvent<HTMLInputElement>): void {
    emitFilters({ ...state.filters, createdFrom: event.currentTarget.value || null })
  }

  function handleCreatedToChange(event: ChangeEvent<HTMLInputElement>): void {
    emitFilters({ ...state.filters, createdTo: event.currentTarget.value || null })
  }

  function handleLayerKeyChange(event: ChangeEvent<HTMLInputElement>): void {
    emitFilters({ ...state.filters, layerKey: event.currentTarget.value || null })
  }

  function handleActorChange(event: ChangeEvent<HTMLInputElement>): void {
    emitFilters({ ...state.filters, actor: event.currentTarget.value || null })
  }

  function handleSourceProjectIdChange(event: ChangeEvent<HTMLInputElement>): void {
    const rawValue = event.currentTarget.value.trim()
    emitFilters({
      ...state.filters,
      sourceProjectId: rawValue === '' ? null : Number.parseInt(rawValue, 10) || null,
    })
  }

  function handleOriginChange(event: ChangeEvent<HTMLSelectElement>): void {
    emitFilters({
      ...state.filters,
      origin: event.currentTarget.value === '' ? null : event.currentTarget.value as HistoryTimelineFilterInput['origin'],
    })
  }

  function handleToggleEventType(eventType: string, checked: boolean): void {
    const nextEventTypes = checked
      ? [...state.filters.eventTypes, eventType]
      : state.filters.eventTypes.filter((value) => value !== eventType)
    emitFilters({ ...state.filters, eventTypes: nextEventTypes })
  }

  function handleResetFilters(): void {
    emitFilters({})
  }

  function handleLoadMore(): void {
    onLoadMore?.(state.nextCursor)
  }

  function handleModeChange(mode: HistoryWorkbenchMode): void {
    onModeChange?.(mode)
  }

  function renderTimelineItem(item: HistoryTimelineItemOut): ReactNode {
    const itemKey = getHistoryTimelineItemKey(item)
    const isExpanded = state.expandedBatchKey === itemKey
    const detail = detailByBatchKey[itemKey]
    const detailUnavailableCopy = describeHistoryDetailStatus(item)
    const targetUnavailableCopy = describeHistoryJumpTarget(item.jump_target)
    const canToggleBatch = item.kind === 'batch' && item.detail_status === 'available'
    const shouldRequestDetail = shouldRequestHistoryBatchDetail(state, item)
    const actorLabel = resolveHistoryActorLabel(item.actors)
    const jumpTarget = item.jump_target

    function handleToggleBatch(): void {
      if (!canToggleBatch) return
      onBatchToggle?.(item, shouldRequestDetail)
    }

    function handleJumpTargetActivate(): void {
      if (jumpTarget?.jump_status !== 'available') return
      onActivateTarget?.(jumpTarget)
    }

    function handleJumpTargetKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
      if (jumpTarget?.jump_status !== 'available') return
      handleHistoryWorkbenchItemActivationKey(
        event.key,
        event.repeat,
        () => event.preventDefault(),
        handleJumpTargetActivate,
      )
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

        {item.jump_target !== null ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {item.jump_target.jump_status === 'available' ? (
              <button
                className="rounded-sm border border-border-subtle px-2 py-1 text-xs font-semibold text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                onClick={handleJumpTargetActivate}
                onKeyDown={handleJumpTargetKeyDown}
                type="button"
              >
                위치로 이동
              </button>
            ) : (
              <button
                aria-disabled="true"
                className="rounded-sm border border-border-subtle px-2 py-1 text-xs font-semibold text-muted"
                disabled
                type="button"
              >
                삭제됨
              </button>
            )}
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
                <HistoryBatchDetailList detail={detail} />
              ) : canToggleBatch ? (
                <p className="rounded-md border border-border-subtle bg-canvas p-2 text-xs text-muted">
                  상세 이력을 불러오는 중입니다.
                </p>
              ) : null
            ) : null}
          </div>
        ) : null}
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
        <div role="tablist" aria-label="이력 모드 선택" className="ml-auto flex gap-2">
          <button
            aria-selected={state.mode === 'timeline'}
            className={modeTabClass(state.mode === 'timeline')}
            onClick={() => handleModeChange('timeline')}
            role="tab"
            type="button"
          >
            타임라인
          </button>
          <button
            aria-selected={state.mode === 'cell'}
            className={modeTabClass(state.mode === 'cell')}
            onClick={() => handleModeChange('cell')}
            role="tab"
            type="button"
          >
            셀 이력
          </button>
        </div>
      </div>

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
          <form
            aria-label="이력 필터"
            className="grid gap-3 rounded-md border border-border-subtle bg-canvas p-3 text-xs"
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="flex flex-col gap-1">
                <span>기간 시작</span>
                <input
                  className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-sm"
                  onChange={handleCreatedFromChange}
                  value={state.filters.createdFrom ?? ''}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span>기간 종료</span>
                <input
                  className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-sm"
                  onChange={handleCreatedToChange}
                  value={state.filters.createdTo ?? ''}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span>Layer</span>
                <input
                  className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-sm"
                  onChange={handleLayerKeyChange}
                  value={state.filters.layerKey ?? ''}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span>Actor</span>
                <input
                  className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-sm"
                  onChange={handleActorChange}
                  value={state.filters.actor ?? ''}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span>Origin/source</span>
                <select
                  className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-sm"
                  onChange={handleOriginChange}
                  value={state.filters.origin ?? ''}
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
                  onChange={handleSourceProjectIdChange}
                  value={state.filters.sourceProjectId ?? ''}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="shrink-0 text-muted">Type</span>
              {HISTORY_EVENT_TYPE_OPTIONS.map((option) => (
                <label key={option.value} className="inline-flex items-center gap-1 rounded-sm border border-border-subtle px-2 py-1 text-xs">
                  <input
                    checked={state.filters.eventTypes.includes(option.value as HistoryTimelineFilterInput['eventTypes'][number])}
                    onChange={(event) => handleToggleEventType(option.value, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-sm border border-border-subtle px-3 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                onClick={handleResetFilters}
                type="button"
              >
                필터 초기화
              </button>
              <span className="text-xs text-muted">
                {timelineItems.length}개 항목 · {state.nextCursor === null ? '마지막 페이지' : '다음 페이지 있음'}
              </span>
            </div>
          </form>

          {timelineStatus === 'loading' ? (
            <div aria-live="polite" className="rounded-md border border-border-subtle bg-canvas p-3 text-sm text-muted" role="status">
              이력을 불러오는 중입니다.
            </div>
          ) : null}

          {hasTimelineError ? (
            <div className="rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error-700" role="alert">
              <div className="flex flex-wrap items-center gap-2">
                <span>{timelineError}</span>
                {onRetry !== undefined ? (
                  <button
                    className="rounded-sm border border-error/30 px-2 py-1 text-xs font-semibold"
                    onClick={onRetry}
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
          ) : (
            <div className="rounded-md border border-border-subtle bg-canvas p-3 text-sm text-muted">
              {timelineStatus === 'loading' ? '이력을 준비하는 중입니다.' : '표시할 변경 이력이 없습니다.'}
            </div>
          )}

          {hasNextPageError ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-700" role="status">
              <div className="flex flex-wrap items-center gap-2">
                <span>{nextPageError}</span>
                {state.nextCursor !== null && onLoadMore !== undefined ? (
                  <button
                    className="rounded-sm border border-warning/30 px-2 py-1 text-xs font-semibold"
                    onClick={handleLoadMore}
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
                onClick={handleLoadMore}
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
                {onRetry !== undefined ? (
                  <button
                    className="rounded-sm border border-error/30 px-2 py-1 text-xs font-semibold"
                    onClick={onRetry}
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

              <div className="space-y-2">
                {cellHistory.items.map((item) => (
                  <HistoryCellHistoryRow key={item.event_id} item={item} />
                ))}
              </div>

              {cellHistory.next_cursor !== null ? (
                <div className="flex justify-center">
                  <button
                    className="rounded-sm border border-border-subtle px-3 py-1 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                    onClick={handleLoadMore}
                    type="button"
                  >
                    더 보기
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-md border border-border-subtle bg-canvas p-3 text-sm text-muted">
              {cellStatus === 'loading' ? '셀 이력을 준비하는 중입니다.' : '표시할 셀 이력이 없습니다.'}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function HistoryBatchDetailList({ detail }: { detail: HistoryDetailOut }) {
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
          {detail.items.map((entry) => (
            <li key={entry.event_id} className="rounded-sm border border-border-subtle bg-surface p-2">
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
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted">상세 항목이 없습니다.</p>
      )}
    </div>
  )
}

function HistoryCellHistoryRow({ item }: { item: HistoryCellHistoryItemOut }) {
  return (
    <article className="rounded-md border border-border-subtle bg-surface p-3 text-xs">
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
      {item.jump_status === 'deleted' ? (
        <p className="mt-2 rounded-sm border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning-700">
          삭제된 대상이라 위치로 이동할 수 없습니다.
        </p>
      ) : null}
    </article>
  )
}

function modeTabClass(selected: boolean): string {
  return cn(
    'rounded-sm border px-2 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700',
    selected
      ? 'border-brand-700 bg-brand-700 text-white'
      : 'border-border-subtle bg-surface text-foreground',
  )
}
