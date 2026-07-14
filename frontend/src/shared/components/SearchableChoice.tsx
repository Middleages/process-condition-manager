import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'

import { cn } from '../lib/cn'
import { useIsomorphicLayoutEffect } from '../lib/useIsomorphicLayoutEffect'
import {
  filterChoiceOptions,
  getVisibleChoiceWindow,
  initialChoiceState,
  reduceChoiceState,
  settleChoiceOpenGeneration,
  shouldPrepareChoiceOnMount,
  type ChoiceState,
  type SearchableChoiceItem,
} from './searchableChoiceState'

export type { SearchableChoiceItem } from './searchableChoiceState'

const OPTION_ROW_HEIGHT = 36
const MAX_VISIBLE_OPTIONS = 60

export interface SearchableChoiceProps {
  id: string
  label: string
  value: string | null
  options: readonly SearchableChoiceItem[]
  loading?: boolean
  error?: string | null
  disabled?: boolean
  sourceActive?: boolean
  selectionReady?: boolean
  allowInactiveSelection?: boolean
  required?: boolean
  allowClear?: boolean
  autoFocus?: boolean
  openOnMount?: boolean
  onOpen?: () => Promise<void>
  onRetry?: () => void
  onChange: (code: string | null) => void
  onCancel?: () => void
}

export interface ChoiceCommitAvailability {
  sourceActive: boolean
  selectionReady: boolean
  generationReady: boolean
  allowInactiveSelection?: boolean
}

export type ChoiceRetryAction = 'prepare' | 'retry' | 'none'

export function getChoiceRetryAction(
  _preparationError: string | null,
  hasOpenPreparation: boolean,
  hasRetryCallback: boolean,
): ChoiceRetryAction {
  if (hasOpenPreparation) return 'prepare'
  return hasRetryCallback ? 'retry' : 'none'
}

export async function settleChoiceRetry(onRetry: () => void): Promise<void> {
  try {
    await onRetry()
  } catch {
    // Retry-owning resources expose their failure through component props. Consuming a thenable
    // returned through the void callback contract prevents a second unhandled error channel.
  }
}

export function canCommitChoice(
  item: SearchableChoiceItem | undefined,
  availability: ChoiceCommitAvailability,
): boolean {
  if (item === undefined || !availability.selectionReady || !availability.generationReady) {
    return false
  }
  if (availability.allowInactiveSelection) return true
  return availability.sourceActive && item.is_active
}

export function SearchableChoice({
  id,
  label,
  value,
  options,
  loading = false,
  error = null,
  disabled = false,
  sourceActive = true,
  selectionReady = true,
  allowInactiveSelection = false,
  required = false,
  allowClear = false,
  autoFocus = false,
  openOnMount = false,
  onOpen,
  onRetry,
  onChange,
  onCancel,
}: SearchableChoiceProps) {
  const initialResults = filterChoiceOptions(options, '', {
    includeInactive: allowInactiveSelection,
  })
  const initialSelectedIndex = value
    ? initialResults.findIndex((item) => item.code === value)
    : -1
  const [state, dispatch] = useReducer(
    reduceChoiceState,
    undefined,
    (): ChoiceState => ({
      ...initialChoiceState,
      open: openOnMount,
      activeIndex:
        openOnMount && initialResults.length > 0
          ? initialSelectedIndex >= 0
            ? initialSelectedIndex
            : 0
          : -1,
      generation: openOnMount ? 1 : 0,
      preparing: openOnMount && onOpen !== undefined,
      readyGeneration: openOnMount && onOpen === undefined ? 1 : null,
    }),
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const generationRef = useRef(state.generation)
  const stateRef = useRef(state)
  const previousSelectionReadyRef = useRef(selectionReady)
  const mountPreparationClaimedRef = useRef(false)

  const results = useMemo(
    () =>
      filterChoiceOptions(options, state.query, {
        includeInactive: allowInactiveSelection,
      }),
    [allowInactiveSelection, options, state.query],
  )
  const selectedItem = value === null ? undefined : options.find((item) => item.code === value)
  const selectedInactive =
    value !== null &&
    selectedItem !== undefined &&
    (!selectedItem.is_active || !sourceActive)
  const effectiveError = state.openError ?? error
  const generationReady =
    state.open &&
    !state.preparing &&
    !loading &&
    effectiveError === null &&
    selectionReady &&
    state.readyGeneration === state.generation
  const listboxDisabled =
    disabled || !generationReady || (!allowInactiveSelection && !sourceActive)
  const visibleIndexes = getVisibleChoiceWindow(
    results.length,
    state.activeIndex,
    MAX_VISIBLE_OPTIONS,
  )
  const firstVisibleIndex = visibleIndexes[0] ?? 0
  const lastVisibleIndex = visibleIndexes[visibleIndexes.length - 1] ?? -1
  const activeOptionId =
    generationReady &&
    state.activeIndex >= 0 &&
    visibleIndexes.includes(state.activeIndex)
      ? choiceOptionId(id, state.activeIndex)
      : undefined
  const listboxId = `${id}-listbox`
  const selectedStatusId = `${id}-selected-status`
  const errorId = effectiveError === null ? undefined : `${id}-error`
  const describedBy = [selectedStatusId, errorId].filter(Boolean).join(' ')

  useIsomorphicLayoutEffect(() => {
    stateRef.current = state
    generationRef.current = Math.max(generationRef.current, state.generation)
  }, [state])

  useIsomorphicLayoutEffect(() => {
    const wasReady = previousSelectionReadyRef.current
    previousSelectionReadyRef.current = selectionReady
    if (wasReady && !selectionReady && state.open) {
      generationRef.current += 1
      dispatch({ type: 'readiness-lost' })
      return
    }
    if (!wasReady && selectionReady && state.open) {
      dispatch({ type: 'readiness-restored', resultCount: results.length })
    }
  }, [results.length, selectionReady, state.open])

  useIsomorphicLayoutEffect(() => {
    if (activeOptionId === undefined || typeof document === 'undefined') return
    document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionId])

  const beginOpen = useCallback(
    (force = false) => {
      if (disabled || (stateRef.current.open && !force)) return
      const currentResults = filterChoiceOptions(options, stateRef.current.query, {
        includeInactive: allowInactiveSelection,
      })
      const selectedIndex =
        value === null ? -1 : currentResults.findIndex((item) => item.code === value)
      const generation = generationRef.current + 1
      generationRef.current = generation
      stateRef.current = {
        ...stateRef.current,
        open: true,
        generation,
      }
      dispatch({
        type: 'open',
        resultCount: currentResults.length,
        activeIndex: selectedIndex >= 0 ? selectedIndex : undefined,
        generation,
        requiresPreparation: onOpen !== undefined,
      })
      if (onOpen !== undefined) {
        void settleChoiceOpenGeneration(generation, onOpen, dispatch)
      }
    },
    [allowInactiveSelection, disabled, onOpen, options, value],
  )

  useEffect(() => {
    if (
      !shouldPrepareChoiceOnMount(
        mountPreparationClaimedRef.current,
        openOnMount,
        onOpen !== undefined,
      )
    ) {
      return
    }
    mountPreparationClaimedRef.current = true
    beginOpen(true)
  }, [beginOpen, onOpen, openOnMount])

  const cancel = useCallback(() => {
    generationRef.current += 1
    stateRef.current = { ...stateRef.current, open: false, generation: generationRef.current }
    dispatch({ type: 'cancel' })
    onCancel?.()
    inputRef.current?.focus()
  }, [onCancel])

  const commit = useCallback(
    (item: SearchableChoiceItem | undefined) => {
      const allowed = canCommitChoice(item, {
        sourceActive,
        selectionReady,
        generationReady,
        allowInactiveSelection,
      })
      dispatch({ type: 'commit', allowed })
      if (!allowed || item === undefined) return
      generationRef.current += 1
      stateRef.current = { ...stateRef.current, open: false, generation: generationRef.current }
      onChange(item.code)
      inputRef.current?.focus()
    },
    [allowInactiveSelection, generationReady, onChange, selectionReady, sourceActive],
  )

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const query = event.currentTarget.value
    const nextResults = filterChoiceOptions(options, query, {
      includeInactive: allowInactiveSelection,
    })
    if (!state.open) beginOpen()
    dispatch({ type: 'input', query, resultCount: nextResults.length })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        if (!state.open) {
          beginOpen()
          return
        }
        dispatch({
          type: 'move',
          delta: event.key === 'ArrowDown' ? 1 : -1,
          resultCount: results.length,
        })
        return
      case 'Home':
        if (!state.open) return
        event.preventDefault()
        dispatch({ type: 'home' })
        return
      case 'End':
        if (!state.open) return
        event.preventDefault()
        dispatch({ type: 'end', resultCount: results.length })
        return
      case 'Enter':
        event.preventDefault()
        if (!state.open) {
          beginOpen()
          return
        }
        commit(results[state.activeIndex])
        return
      case 'Escape':
        if (!state.open) return
        event.preventDefault()
        cancel()
        return
    }
  }

  const handleRetry = () => {
    const retryAction = getChoiceRetryAction(
      state.openError,
      onOpen !== undefined,
      onRetry !== undefined,
    )
    if (retryAction === 'prepare') beginOpen(true)
    if (retryAction === 'retry' && onRetry !== undefined) {
      void settleChoiceRetry(onRetry)
    }
  }

  return (
    <div className="relative grid min-w-0 gap-1.5" data-searchable-choice="">
      <label className="text-sm font-semibold text-ink-950" htmlFor={id}>
        {label}
        {required ? <span className="ml-1 text-error" aria-hidden="true">*</span> : null}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          className="input pr-24 font-mono"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={state.open}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-describedby={describedBy}
          aria-invalid={effectiveError === null ? undefined : true}
          aria-required={required || undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          value={state.query}
          placeholder={selectedItem ? `${selectedItem.code} · ${selectedItem.label}` : '코드 또는 라벨 검색'}
          onChange={handleInput}
          onClick={() => beginOpen()}
          onFocus={() => beginOpen()}
          onKeyDown={handleKeyDown}
        />
        {!disabled ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted"
          >
            {state.preparing || loading ? '새로 고침 중' : state.open ? '열림' : '열기'}
          </span>
        ) : null}
      </div>

      <div
        id={selectedStatusId}
        className={cn(
          'flex min-h-5 flex-wrap items-center gap-2 text-xs',
          selectedInactive ? 'text-warning' : 'text-muted',
        )}
        role="status"
        aria-live="polite"
      >
        <span className="font-mono">
          {value === null
            ? '선택 없음'
            : selectedItem
              ? `${selectedItem.code} · ${selectedItem.label}`
              : value}
        </span>
        {selectedInactive ? (
          <span className="rounded-full bg-warning-surface px-2 py-0.5 font-semibold text-warning">
            사용 중지됨
          </span>
        ) : null}
        {allowClear && value !== null ? (
          <button
            type="button"
            className="font-semibold text-brand-700 underline underline-offset-2 disabled:text-muted"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            선택 해제
          </button>
        ) : null}
      </div>

      {effectiveError !== null ? (
        <div
          id={errorId}
          className="flex items-center justify-between gap-3 rounded-md border border-error bg-error-surface px-3 py-2 text-sm text-error"
          role="alert"
        >
          <span>{effectiveError}</span>
          <button
            type="button"
            className="shrink-0 font-semibold underline underline-offset-2"
            onClick={handleRetry}
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {state.open ? (
        <div
          id={listboxId}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border-control bg-surface py-1 shadow-lg"
          role="listbox"
          aria-busy={state.preparing || loading || undefined}
          aria-disabled={listboxDisabled || undefined}
          aria-label={`${label} 선택지`}
        >
          {state.preparing || loading ? (
            <div className="px-3 py-2 text-sm text-muted" role="status">
              최신 선택지를 확인하는 중입니다.
            </div>
          ) : null}
          {results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted" aria-disabled="true">
              선택 가능한 항목이 없습니다.
            </div>
          ) : (
            <>
              {firstVisibleIndex > 0 ? (
                <div aria-hidden="true" style={{ height: firstVisibleIndex * OPTION_ROW_HEIGHT }} />
              ) : null}
              {visibleIndexes.map((resultIndex) => {
                const item = results[resultIndex]!
                const selected = item.code === value
                const committable = canCommitChoice(item, {
                  sourceActive,
                  selectionReady,
                  generationReady,
                  allowInactiveSelection,
                })
                return (
                  <div
                    key={item.code}
                    id={choiceOptionId(id, resultIndex)}
                    className={cn(
                      'flex h-9 cursor-default items-center justify-between gap-3 px-3 text-sm',
                      resultIndex === state.activeIndex && generationReady
                        ? 'bg-brand-100 text-ink-950'
                        : 'text-ink-950',
                      selected && 'font-semibold',
                      !committable && 'opacity-70',
                    )}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={!committable || undefined}
                    aria-posinset={resultIndex + 1}
                    aria-setsize={results.length}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => commit(item)}
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-mono">{item.code}</span> · {item.label}
                    </span>
                    {selected ? <span className="shrink-0 text-xs text-brand-700">현재 값</span> : null}
                  </div>
                )
              })}
              {lastVisibleIndex + 1 < results.length ? (
                <div
                  aria-hidden="true"
                  style={{ height: (results.length - lastVisibleIndex - 1) * OPTION_ROW_HEIGHT }}
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function choiceOptionId(id: string, resultIndex: number): string {
  return `${id}-option-${resultIndex}`
}
