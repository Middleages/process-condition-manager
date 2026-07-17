import {
  createBackboneDiffRootQueryOptions,
  type BackboneDiffRootQueryOptions,
  type BackboneDiffRootQueryInput,
} from '@/api/backboneDiffQuery'
import type {
  BackboneDiffCellItemOut,
  BackboneDiffConditionItemOut,
  BackboneDiffCountsOut,
  BackboneDiffLayerSummaryOut,
  BackboneDiffPreviewItemOut,
  BackboneDiffRootOut,
} from '@/api/backboneDiff'

export interface BackboneDiffRootPage {
  readonly items: readonly BackboneDiffPreviewItemOut[]
}

export interface BackboneDiffConditionPage {
  readonly items: readonly BackboneDiffConditionItemOut[]
  readonly nextCursor: string | null
}

export interface BackboneDiffCellPage {
  readonly items: readonly BackboneDiffCellItemOut[]
  readonly nextCursor: string | null
}

export type BackboneDiffWorkbenchMode = 'root' | 'branch' | 'cell'

export interface BackboneDiffWorkbenchState {
  readonly filters: BackboneDiffRootQueryOptions
  readonly revision: number
  readonly rootScope: string | null
  readonly rootBasisHash: string | null
  readonly rootCounts: BackboneDiffCountsOut | null
  readonly layerSummaries: readonly BackboneDiffLayerSummaryOut[]
  readonly previewItems: readonly BackboneDiffPreviewItemOut[]
  readonly mode: BackboneDiffWorkbenchMode
  readonly openLayerKey: string | null
  readonly branchScope: string | null
  readonly branchPages: readonly BackboneDiffConditionPage[]
  readonly branchNextCursor: string | null
  readonly openCellLayerKey: string | null
  readonly openCellRowRef: string | null
  readonly openCellScope: string | null
  readonly cellPages: readonly BackboneDiffCellPage[]
  readonly cellNextCursor: string | null
  readonly navigationAnnouncement: string | null
}

type BackboneDiffWorkbenchAction =
  | { readonly type: 'replace-filters'; readonly filters: BackboneDiffRootQueryInput }
  | { readonly type: 'set-root-result'; readonly result: BackboneDiffRootOut }
  | {
      readonly type: 'set-root-status'
      readonly result: Pick<BackboneDiffWorkbenchState, 'rootScope' | 'rootBasisHash' | 'filters'>
    }
  | {
      readonly type: 'open-branch'
      readonly layerKey: string
      readonly scope: string
    }
  | { readonly type: 'close-branch' }
  | {
      readonly type: 'set-branch-pages'
      readonly pages: readonly BackboneDiffConditionPage[]
      readonly nextCursor: string | null
    }
  | {
      readonly type: 'open-cell'
      readonly layerKey: string
      readonly rowRef: string
      readonly scope: string
    }
  | { readonly type: 'close-cell' }
  | {
      readonly type: 'set-cell-pages'
      readonly pages: readonly BackboneDiffCellPage[]
      readonly nextCursor: string | null
    }
  | { readonly type: 'announce-navigation'; readonly message: string | null }
  | { readonly type: 'clear-opened-scopes' }

const EMPTY_ROOT_COUNTS: BackboneDiffCountsOut = {
  layer_count: 0,
  available_layer_count: 0,
  unavailable_layer_count: 0,
  row_count: 0,
  cell_count: 0,
  full_row_count: 0,
  full_cell_count: 0,
  ambiguous_lineage_count: 0,
  added_count: 0,
  changed_count: 0,
  cleared_count: 0,
  removed_count: 0,
  unchanged_count: 0,
}

export function createBackboneDiffWorkbenchState(
  filters: BackboneDiffRootQueryInput = {},
): BackboneDiffWorkbenchState {
  return {
    filters: createBackboneDiffRootQueryOptions(filters),
    revision: 0,
    rootScope: null,
    rootBasisHash: null,
    rootCounts: EMPTY_ROOT_COUNTS,
    layerSummaries: [],
    previewItems: [],
    mode: 'root',
    openLayerKey: null,
    branchScope: null,
    branchPages: [],
    branchNextCursor: null,
    openCellLayerKey: null,
    openCellRowRef: null,
    openCellScope: null,
    cellPages: [],
    cellNextCursor: null,
    navigationAnnouncement: null,
  }
}

export function reduceBackboneDiffWorkbenchState(
  state: BackboneDiffWorkbenchState,
  action: BackboneDiffWorkbenchAction,
): BackboneDiffWorkbenchState {
  switch (action.type) {
    case 'replace-filters': {
      const filters = createBackboneDiffRootQueryOptions(action.filters)
      if (sameRootQuery(filters, state.filters)) return state
      return {
        ...state,
        filters,
        revision: state.revision + 1,
        rootScope: null,
        rootBasisHash: null,
        rootCounts: EMPTY_ROOT_COUNTS,
        layerSummaries: [],
        previewItems: [],
        mode: 'root',
        openLayerKey: null,
        branchScope: null,
        branchPages: [],
        branchNextCursor: null,
        openCellLayerKey: null,
        openCellRowRef: null,
        openCellScope: null,
        cellPages: [],
        cellNextCursor: null,
        navigationAnnouncement: null,
      }
    }

    case 'set-root-result': {
      const result = action.result
      const nextRootScope = result.scope
      const nextBasisHash = result.basis_hash
      const isIdenticalRootPublication =
        state.rootScope === nextRootScope &&
        state.rootBasisHash === nextBasisHash &&
        state.rootCounts === result.counts &&
        state.layerSummaries === result.layer_summaries &&
        state.previewItems === result.changed_preview

      if (isIdenticalRootPublication) return state

      const scopeOrBasisChanged =
        state.rootScope !== nextRootScope || state.rootBasisHash !== nextBasisHash
      const shouldAnnounceBasisChange =
        state.rootScope !== null &&
        state.rootBasisHash !== null &&
        scopeOrBasisChanged

      return {
        ...state,
        rootScope: nextRootScope,
        rootBasisHash: nextBasisHash,
        rootCounts: result.counts,
        layerSummaries: result.layer_summaries,
        previewItems: result.changed_preview,
        ...(scopeOrBasisChanged
          ? {
              revision: state.revision + 1,
              mode: 'root',
              openLayerKey: null,
              branchScope: null,
              branchPages: [],
              branchNextCursor: null,
              openCellLayerKey: null,
              openCellRowRef: null,
              openCellScope: null,
              cellPages: [],
              cellNextCursor: null,
              ...(shouldAnnounceBasisChange
                ? { navigationAnnouncement: '백본 비교 기준이 변경되어 새로고침합니다.' }
                : {}),
            }
          : {}),
      }
    }

    case 'set-root-status': {
      const next = {
        ...state,
        filters: normalizeRootQueryFromProjection(action.result.filters, state.filters),
        rootScope: action.result.rootScope,
        rootBasisHash: action.result.rootBasisHash,
      }
      if (
        next.rootScope === state.rootScope &&
        next.rootBasisHash === state.rootBasisHash &&
        sameRootQuery(next.filters, state.filters)
      ) {
        return state
      }
      return {
        ...next,
        revision: state.revision + 1,
        openLayerKey: null,
        branchScope: null,
        branchPages: [],
        branchNextCursor: null,
        openCellLayerKey: null,
        openCellRowRef: null,
        openCellScope: null,
        cellPages: [],
        cellNextCursor: null,
      }
    }

    case 'open-branch': {
      if (state.openLayerKey === action.layerKey && state.branchScope === action.scope) {
        return {
          ...state,
          mode: state.mode === 'branch' ? 'root' : 'branch',
          ...(state.mode === 'branch'
            ? {
                openLayerKey: null,
                branchScope: null,
                branchPages: [],
                branchNextCursor: null,
                openCellLayerKey: null,
                openCellRowRef: null,
                openCellScope: null,
                cellPages: [],
                cellNextCursor: null,
              }
            : {}),
        }
      }

      return {
        ...state,
        mode: 'branch',
        openLayerKey: action.layerKey,
        branchScope: action.scope,
        openCellLayerKey: null,
        openCellRowRef: null,
        openCellScope: null,
        cellPages: [],
        cellNextCursor: null,
        branchPages: [],
        branchNextCursor: null,
      }
    }

    case 'close-branch':
      return state.mode === 'root'
        ? state
        : {
            ...state,
            mode: 'root',
            openLayerKey: null,
            branchScope: null,
            branchPages: [],
            branchNextCursor: null,
            openCellLayerKey: null,
            openCellRowRef: null,
            openCellScope: null,
            cellPages: [],
            cellNextCursor: null,
          }

    case 'set-branch-pages':
      if (state.mode !== 'branch' && state.mode !== 'cell') {
        return state
      }
      if (sameConditionPages(state.branchPages, state.branchNextCursor, action.pages, action.nextCursor)) {
        return state
      }
      return {
        ...state,
        branchPages: action.pages,
        branchNextCursor: action.nextCursor,
      }

    case 'open-cell': {
      if (
        state.openCellLayerKey === action.layerKey &&
        state.openCellRowRef === action.rowRef &&
        state.openCellScope === action.scope
      ) {
        return {
          ...state,
          mode: state.mode === 'cell' ? 'branch' : 'cell',
        }
      }

      return {
        ...state,
        mode: 'cell',
        openCellLayerKey: action.layerKey,
        openCellRowRef: action.rowRef,
        openCellScope: action.scope,
        cellPages: [],
        cellNextCursor: null,
      }
    }

    case 'close-cell':
      return state.mode !== 'cell'
        ? state
        : {
            ...state,
            mode: 'branch',
            openCellLayerKey: null,
            openCellRowRef: null,
            openCellScope: null,
            cellPages: [],
            cellNextCursor: null,
          }

    case 'set-cell-pages':
      if (state.mode !== 'cell') {
        return state
      }
      if (sameCellPages(state.cellPages, state.cellNextCursor, action.pages, action.nextCursor)) {
        return state
      }
      return {
        ...state,
        cellPages: action.pages,
        cellNextCursor: action.nextCursor,
      }

    case 'announce-navigation':
      if (state.navigationAnnouncement === action.message) return state
      return { ...state, navigationAnnouncement: action.message }

    case 'clear-opened-scopes':
      if (
        state.openLayerKey === null &&
        state.openCellLayerKey === null &&
        state.branchScope === null &&
        state.openCellScope === null
      ) {
        return state
      }
      return {
        ...state,
        revision: state.revision + 1,
        mode: 'root',
        openLayerKey: null,
        branchScope: null,
        branchPages: [],
        branchNextCursor: null,
        openCellLayerKey: null,
        openCellRowRef: null,
        openCellScope: null,
        cellPages: [],
        cellNextCursor: null,
      }

    default:
      return state
  }
}

export function setBackboneDiffRootResult(
  state: BackboneDiffWorkbenchState,
  result: BackboneDiffRootOut,
): BackboneDiffWorkbenchState {
  return reduceBackboneDiffWorkbenchState(state, { type: 'set-root-result', result })
}

export function replaceBackboneDiffFilters(
  state: BackboneDiffWorkbenchState,
  filters: BackboneDiffRootQueryInput,
): BackboneDiffWorkbenchState {
  return reduceBackboneDiffWorkbenchState(state, { type: 'replace-filters', filters })
}

export function openBackboneDiffBranch(
  state: BackboneDiffWorkbenchState,
  layerKey: string,
  scope: string,
): BackboneDiffWorkbenchState {
  return reduceBackboneDiffWorkbenchState(state, { type: 'open-branch', layerKey, scope })
}

export function closeBackboneDiffBranch(state: BackboneDiffWorkbenchState): BackboneDiffWorkbenchState {
  return reduceBackboneDiffWorkbenchState(state, { type: 'close-branch' })
}

export function setBackboneDiffBranchPages(
  state: BackboneDiffWorkbenchState,
  pages: readonly BackboneDiffConditionPage[],
  nextCursor: string | null,
): BackboneDiffWorkbenchState {
  return reduceBackboneDiffWorkbenchState(state, {
    type: 'set-branch-pages',
    pages,
    nextCursor,
  })
}

export function openBackboneDiffCell(
  state: BackboneDiffWorkbenchState,
  layerKey: string,
  rowRef: string,
  scope: string,
): BackboneDiffWorkbenchState {
  return reduceBackboneDiffWorkbenchState(state, { type: 'open-cell', layerKey, rowRef, scope })
}

export function closeBackboneDiffCell(state: BackboneDiffWorkbenchState): BackboneDiffWorkbenchState {
  return reduceBackboneDiffWorkbenchState(state, { type: 'close-cell' })
}

export function setBackboneDiffCellPages(
  state: BackboneDiffWorkbenchState,
  pages: readonly BackboneDiffCellPage[],
  nextCursor: string | null,
): BackboneDiffWorkbenchState {
  return reduceBackboneDiffWorkbenchState(state, {
    type: 'set-cell-pages',
    pages,
    nextCursor,
  })
}

export function announceBackboneDiffNavigation(
  state: BackboneDiffWorkbenchState,
  message: string | null,
): BackboneDiffWorkbenchState {
  return reduceBackboneDiffWorkbenchState(state, {
    type: 'announce-navigation',
    message,
  })
}

export function clearBackboneDiffOpenScopes(
  state: BackboneDiffWorkbenchState,
): BackboneDiffWorkbenchState {
  return reduceBackboneDiffWorkbenchState(state, { type: 'clear-opened-scopes' })
}

function sameRootQuery(
  left: BackboneDiffRootQueryOptions,
  right: BackboneDiffRootQueryOptions,
): boolean {
  return (
    left.previewLimit === right.previewLimit &&
    left.includeUnchanged === right.includeUnchanged &&
    left.layerKey === right.layerKey &&
    left.categoryCode === right.categoryCode &&
    left.parameterCode === right.parameterCode &&
    left.classification.length === right.classification.length &&
    left.classification.every((value, index) => value === right.classification[index])
  )
}

function sameConditionPages(
  currentPages: readonly BackboneDiffConditionPage[],
  currentNextCursor: string | null,
  nextPages: readonly BackboneDiffConditionPage[],
  nextCursor: string | null,
): boolean {
  return currentNextCursor === nextCursor && currentPages === nextPages
}

function sameCellPages(
  currentPages: readonly BackboneDiffCellPage[],
  currentNextCursor: string | null,
  nextPages: readonly BackboneDiffCellPage[],
  nextCursor: string | null,
): boolean {
  return currentNextCursor === nextCursor && currentPages === nextPages
}

function normalizeRootQueryFromProjection(
  filters: BackboneDiffRootQueryOptions,
  fallback: BackboneDiffRootQueryOptions,
): BackboneDiffRootQueryOptions {
  if ((filters as unknown as { includeUnchanged?: boolean }) === undefined) {
    return fallback
  }
  return createBackboneDiffRootQueryOptions(filters)
}
