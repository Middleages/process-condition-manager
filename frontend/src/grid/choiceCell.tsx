import { GridCellKind, drawTextCell } from '@glideapps/glide-data-grid'
import type {
  CustomCell,
  CustomRenderer,
  ProvideEditorComponent,
  Theme,
} from '@glideapps/glide-data-grid'
import { useCallback, useSyncExternalStore } from 'react'

import { SearchableChoice } from '@/shared/components/SearchableChoice'

import { optionIndexForAggregate } from './cellValue'
import type { SheetChoiceResource } from './types'

interface LiveChoiceResourceStore {
  snapshot: SheetChoiceResource
  listeners: Set<() => void>
  preparationEpoch: number
}

const liveChoiceResourceStores = new WeakMap<SheetChoiceResource, LiveChoiceResourceStore>()
const liveChoiceResourceKeys = [
  'setCode',
  'targetVersion',
  'summaryVersion',
  'setIsActive',
  'displayAggregate',
  'selectableAggregate',
  'selectionReady',
  'isStale',
  'loading',
  'error',
  'prepareToOpen',
  'retry',
] as const satisfies readonly (keyof SheetChoiceResource)[]

/**
 * Glide owns an editor overlay after opening it, so a later grid render cannot replace the
 * resource prop captured by that overlay. This stable handle forwards every field to a live
 * snapshot while keeping one shared identity per set (and no per-cell option copy).
 */
export function createLiveChoiceResource(
  initialSnapshot: SheetChoiceResource,
): SheetChoiceResource {
  const store: LiveChoiceResourceStore = {
    snapshot: initialSnapshot,
    listeners: new Set(),
    preparationEpoch: 0,
  }
  const resource = {} as SheetChoiceResource
  for (const key of liveChoiceResourceKeys) {
    Object.defineProperty(resource, key, {
      enumerable: true,
      get: () => store.snapshot[key],
    })
  }
  liveChoiceResourceStores.set(resource, store)
  return resource
}

export function getLiveChoiceResourceSnapshot(
  resource: SheetChoiceResource,
): SheetChoiceResource {
  return liveChoiceResourceStores.get(resource)?.snapshot ?? resource
}

export function stageLiveChoiceResource(
  resource: SheetChoiceResource,
  snapshot: SheetChoiceResource,
): () => boolean {
  // Render only captures this exact snapshot. An abandoned render never invokes the closure.
  return () => publishLiveChoiceResource(resource, snapshot)
}

/** Only the latest mandatory editor-open attempt may publish, including after a newer failure. */
export function claimLiveChoiceResourcePreparation(
  resource: SheetChoiceResource,
): (snapshot: SheetChoiceResource) => boolean {
  const store = liveChoiceResourceStores.get(resource)
  if (store === undefined) return () => false
  const epoch = store.preparationEpoch + 1
  store.preparationEpoch = epoch
  return (snapshot) => {
    const current = liveChoiceResourceStores.get(resource)
    if (current === undefined || current.preparationEpoch !== epoch) return false
    return publishLiveChoiceResource(resource, snapshot)
  }
}

export function notifyLiveChoiceResource(resource: SheetChoiceResource): void {
  const store = liveChoiceResourceStores.get(resource)
  if (store === undefined) return
  for (const listener of store.listeners) listener()
}

export function publishLiveChoiceResource(
  resource: SheetChoiceResource,
  snapshot: SheetChoiceResource,
): boolean {
  const store = liveChoiceResourceStores.get(resource)
  if (store === undefined) return false
  const current = store.snapshot
  // A delayed open/render may finish after a newer immutable version is already authoritative.
  if (snapshot.targetVersion < current.targetVersion) return false
  if (
    snapshot.summaryVersion !== null &&
    current.summaryVersion !== null &&
    snapshot.summaryVersion < current.summaryVersion
  ) {
    return false
  }
  if (sameChoiceResourceState(current, snapshot)) return false
  store.snapshot = snapshot
  notifyLiveChoiceResource(resource)
  return true
}

function sameChoiceResourceState(
  left: SheetChoiceResource,
  right: SheetChoiceResource,
): boolean {
  return (
    left.setCode === right.setCode &&
    left.targetVersion === right.targetVersion &&
    left.summaryVersion === right.summaryVersion &&
    left.setIsActive === right.setIsActive &&
    left.displayAggregate === right.displayAggregate &&
    left.selectableAggregate === right.selectableAggregate &&
    left.selectionReady === right.selectionReady &&
    left.isStale === right.isStale &&
    left.loading === right.loading &&
    left.error === right.error
  )
}

export function subscribeLiveChoiceResource(
  resource: SheetChoiceResource,
  listener: () => void,
): () => void {
  const store = liveChoiceResourceStores.get(resource)
  if (store === undefined) return () => undefined
  store.listeners.add(listener)
  return () => store.listeners.delete(listener)
}

export function useLiveChoiceResource(resource: SheetChoiceResource): SheetChoiceResource {
  const subscribe = useCallback(
    (listener: () => void) => subscribeLiveChoiceResource(resource, listener),
    [resource],
  )
  const getSnapshot = useCallback(() => getLiveChoiceResourceSnapshot(resource), [resource])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export type ChoiceValueDescription = {
  kind: 'empty' | 'active' | 'inactive' | 'raw' | 'error'
  displayText: string
  tooltip: string
  badge: string | null
  retry: (() => Promise<void>) | null
}

export interface ChoiceCellPayload extends ChoiceValueDescription {
  readonly cellKind: 'choice-cell'
  readonly value: string
  readonly resource: SheetChoiceResource
  readonly restoreGridFocus: () => void
}

export type ChoiceCell = CustomCell<ChoiceCellPayload>

export function isChoiceCell(cell: CustomCell): cell is ChoiceCell {
  return (cell.data as Partial<ChoiceCellPayload>).cellKind === 'choice-cell'
}

export function describeChoiceValue(
  value: string,
  resource: SheetChoiceResource,
): ChoiceValueDescription {
  if (value === '') {
    return { kind: 'empty', displayText: '', tooltip: '', badge: null, retry: null }
  }
  const aggregate = resource.displayAggregate
  const option = aggregate === null ? undefined : optionIndexForAggregate(aggregate).get(value)
  if (option !== undefined) {
    const inactive = resource.setIsActive === false || !option.is_active
    return {
      kind: inactive ? 'inactive' : 'active',
      displayText: option.label,
      tooltip: `${option.code} · ${option.label}`,
      badge: inactive ? '사용 중지됨' : null,
      retry: resource.error === null ? null : resource.retry,
    }
  }
  return {
    kind: resource.error === null ? 'raw' : 'error',
    displayText: value,
    tooltip: value,
    badge: null,
    retry: resource.error === null ? null : resource.retry,
  }
}

const NOOP_FOCUS = () => undefined

function payload(
  value: string,
  resource: SheetChoiceResource,
  restoreGridFocus: () => void,
): ChoiceCellPayload {
  return {
    cellKind: 'choice-cell',
    value,
    resource,
    restoreGridFocus,
    ...describeChoiceValue(value, resource),
  }
}

type FocusScheduler = (callback: () => void) => void

function scheduleNextFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback)
    return
  }
  setTimeout(callback, 0)
}

/** SearchableChoice의 동기 input refocus보다 뒤에서 Glide canvas focus를 복구한다. */
export function finishChoiceEditingWithFocus(
  finish: (value?: ChoiceCell) => void,
  value: ChoiceCell | undefined,
  restoreGridFocus: () => void,
  schedule: FocusScheduler = scheduleNextFrame,
): void {
  finish(value)
  schedule(restoreGridFocus)
}

export function makeChoiceCell(
  value: string,
  resource: SheetChoiceResource,
  readOnly: boolean,
  themeOverride?: Partial<Theme>,
  restoreGridFocus: () => void = NOOP_FOCUS,
): ChoiceCell {
  return {
    kind: GridCellKind.Custom,
    allowOverlay: !readOnly,
    readonly: readOnly,
    activationBehaviorOverride: readOnly ? undefined : 'single-click',
    copyData: value,
    themeOverride,
    data: payload(value, resource, restoreGridFocus),
  }
}

export const ChoiceEditor: ProvideEditorComponent<ChoiceCell> = ({
  value: cell,
  onFinishedEditing,
}) => {
  const resource = useLiveChoiceResource(cell.data.resource)
  const { value } = cell.data
  const currentDescription = describeChoiceValue(value, resource)
  return (
    <div
      className="min-w-[280px] bg-surface p-2"
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' ||
          event.key === 'Escape' ||
          event.key === 'ArrowDown' ||
          event.key === 'ArrowUp' ||
          event.key === 'Home' ||
          event.key === 'End'
        ) {
          event.stopPropagation()
        }
      }}
    >
      <SearchableChoice
        id="sheet-choice-editor"
        label="선택지"
        value={value === '' ? null : value}
        options={resource.displayAggregate?.items ?? []}
        loading={resource.loading}
        error={resource.error}
        sourceActive={resource.setIsActive === true}
        sourceInactive={currentDescription.kind === 'inactive'}
        selectionReady={resource.selectionReady}
        allowClear
        autoFocus
        openOnMount
        onOpen={resource.prepareToOpen}
        onRetry={resource.retry}
        onCancel={() =>
          finishChoiceEditingWithFocus(
            onFinishedEditing,
            undefined,
            cell.data.restoreGridFocus,
          )
        }
        onChange={(next) => {
          const nextValue = next ?? ''
          finishChoiceEditingWithFocus(
            onFinishedEditing,
            {
              ...cell,
              copyData: nextValue,
              data: payload(
                nextValue,
                cell.data.resource,
                cell.data.restoreGridFocus,
              ),
            },
            cell.data.restoreGridFocus,
          )
        }}
      />
    </div>
  )
}

export const choiceCellRenderer: CustomRenderer<ChoiceCell> = {
  kind: GridCellKind.Custom,
  isMatch: isChoiceCell,
  draw: (args, cell) => {
    const badge = cell.data.badge === null ? '' : ` · ${cell.data.badge}`
    const error = cell.data.kind === 'error' ? ' ⚠' : ''
    drawTextCell(args, `${cell.data.displayText}${badge}${error}`, cell.contentAlign)
    drawTextCell(args, '▾', 'right')
  },
  provideEditor: () => ({
    editor: ChoiceEditor,
    disablePadding: true,
    styleOverride: { minWidth: 320, minHeight: 320 },
  }),
  onPaste: (raw, data) => ({ ...data, value: raw, ...describeChoiceValue(raw, data.resource) }),
}
