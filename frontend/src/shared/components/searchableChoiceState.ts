export interface SearchableChoiceItem {
  code: string
  label: string
  is_active: boolean
}

export interface ChoiceState {
  open: boolean
  query: string
  activeIndex: number
  generation: number
  preparing: boolean
  readyGeneration: number | null
  openError: string | null
}

export type ChoiceStateAction =
  | {
      type: 'open'
      resultCount: number
      activeIndex?: number
      generation?: number
      requiresPreparation?: boolean
    }
  | { type: 'input'; query: string; resultCount: number }
  | { type: 'move'; delta: number; resultCount: number }
  | { type: 'home' }
  | { type: 'end'; resultCount: number }
  | { type: 'commit'; allowed: boolean }
  | { type: 'cancel' }
  | { type: 'prepare-succeeded'; generation: number }
  | { type: 'prepare-failed'; generation: number; error: string }
  | { type: 'readiness-lost' }
  | { type: 'readiness-restored'; resultCount: number }

export const initialChoiceState: ChoiceState = {
  open: false,
  query: '',
  activeIndex: -1,
  generation: 0,
  preparing: false,
  readyGeneration: null,
  openError: null,
}

export function filterChoiceOptions<T extends SearchableChoiceItem>(
  options: readonly T[],
  query: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): T[] {
  const needle = query.trim().toLowerCase()
  return options.filter(
    (item) =>
      (includeInactive || item.is_active) &&
      (needle === '' ||
        item.code.toLowerCase().includes(needle) ||
        item.label.toLowerCase().includes(needle)),
  )
}

/**
 * Returns the contiguous portion of the full result indexes that may be mounted.
 * Filtering remains unbounded; only DOM rows are windowed.
 */
export function getVisibleChoiceWindow(
  resultCount: number,
  activeIndex: number,
  maximumRows = 60,
): number[] {
  const count = Math.max(0, Math.floor(resultCount))
  const limit = Math.max(0, Math.floor(maximumRows))
  if (count === 0 || limit === 0) return []

  const size = Math.min(count, limit)
  const active = activeIndex < 0 ? 0 : Math.min(Math.floor(activeIndex), count - 1)
  const maximumStart = count - size
  const start = Math.min(Math.max(0, active - Math.floor(size / 2)), maximumStart)
  return Array.from({ length: size }, (_, offset) => start + offset)
}

export function shouldPrepareChoiceOnMount(
  alreadyPrepared: boolean,
  openOnMount: boolean,
  hasOpenPreparation: boolean,
): boolean {
  return !alreadyPrepared && openOnMount && hasOpenPreparation
}

export function reduceChoiceState(
  state: ChoiceState,
  action: ChoiceStateAction,
): ChoiceState {
  switch (action.type) {
    case 'open': {
      const generation =
        action.generation !== undefined && action.generation > state.generation
          ? action.generation
          : state.generation + 1
      const activeIndex = clampActiveIndex(
        action.activeIndex ?? (action.resultCount > 0 ? 0 : -1),
        action.resultCount,
      )
      return {
        ...state,
        open: true,
        activeIndex,
        generation,
        preparing: action.requiresPreparation ?? false,
        readyGeneration: action.requiresPreparation ? null : generation,
        openError: null,
      }
    }
    case 'input':
      return {
        ...state,
        query: action.query,
        activeIndex: action.resultCount > 0 ? 0 : -1,
      }
    case 'move': {
      if (action.resultCount <= 0) return { ...state, activeIndex: -1 }
      const current = state.activeIndex < 0 ? 0 : state.activeIndex
      const activeIndex = modulo(current + action.delta, action.resultCount)
      return { ...state, activeIndex }
    }
    case 'home':
      return { ...state, activeIndex: state.activeIndex < 0 ? -1 : 0 }
    case 'end':
      return { ...state, activeIndex: action.resultCount > 0 ? action.resultCount - 1 : -1 }
    case 'commit':
      return action.allowed ? closeState(state) : state
    case 'cancel':
      return closeState(state)
    case 'prepare-succeeded':
      if (!state.open || action.generation !== state.generation) return state
      return {
        ...state,
        preparing: false,
        readyGeneration: action.generation,
        openError: null,
      }
    case 'prepare-failed':
      if (!state.open || action.generation !== state.generation) return state
      return {
        ...state,
        activeIndex: -1,
        preparing: false,
        readyGeneration: null,
        openError: action.error,
      }
    case 'readiness-lost':
      if (!state.open) return state
      return {
        ...state,
        activeIndex: -1,
        generation: state.generation + 1,
        preparing: false,
        readyGeneration: null,
      }
    case 'readiness-restored':
      if (!state.open || state.preparing || state.openError !== null) return state
      return {
        ...state,
        activeIndex: action.resultCount > 0 ? 0 : -1,
        readyGeneration: state.generation,
      }
  }
}

/**
 * Settles a single asynchronous open attempt. Rejections are deliberately consumed and
 * represented in reducer state so event-handler promises never become unhandled.
 */
export async function settleChoiceOpenGeneration(
  generation: number,
  prepareToOpen: () => Promise<void>,
  dispatch: (action: ChoiceStateAction) => void,
): Promise<void> {
  try {
    await prepareToOpen()
    dispatch({ type: 'prepare-succeeded', generation })
  } catch (error) {
    dispatch({
      type: 'prepare-failed',
      generation,
      error: error instanceof Error ? error.message : '선택지를 새로 고치지 못했습니다.',
    })
  }
}

function closeState(state: ChoiceState): ChoiceState {
  return {
    ...state,
    open: false,
    query: '',
    activeIndex: -1,
    generation: state.generation + 1,
    preparing: false,
    readyGeneration: null,
    openError: null,
  }
}

function clampActiveIndex(activeIndex: number, resultCount: number): number {
  if (resultCount <= 0) return -1
  return Math.min(Math.max(0, Math.floor(activeIndex)), resultCount - 1)
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}
