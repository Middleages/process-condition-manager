import { useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from 'react'
import { filterLayerNavigatorItems, resolveLayerNavigatorIndex, type LayerNavigatorItem } from './layerNavigatorState'

export interface LayerNavigatorProps {
  items: readonly LayerNavigatorItem[]
  activeLayerKey: string
  recentLayerKeys: readonly string[]
  query: string
  collapsed: boolean
  currentOnly: boolean
  onQueryChange(query: string): void
  onActivate(layerKey: string): void
  onCollapsedChange(collapsed: boolean): void
  onCurrentOnlyChange(currentOnly: boolean): void
}

const ROW_HEIGHT = 36
const VIEWPORT_HEIGHT = 432
const OVERSCAN = 3

export function LayerNavigator(props: LayerNavigatorProps) {
  const { items, activeLayerKey, recentLayerKeys, query, collapsed, currentOnly, onQueryChange, onActivate, onCollapsedChange, onCurrentOnlyChange } = props
  const [scrollTop, setScrollTop] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const filtered = useMemo(() => filterLayerNavigatorItems(items, query), [items, query])
  const recent = recentLayerKeys.map((key) => items.find((item) => item.key === key)).filter((item): item is LayerNavigatorItem => item != null)

  if (collapsed) {
    return (
      <nav className="flex h-full w-11 flex-col items-center border-r border-border-subtle bg-canvas py-2" data-layer-navigator-collapsed="true" aria-label="Layer 선택">
        <button className="h-9 w-9 border border-border-control bg-surface text-lg font-semibold text-brand-700 hover:bg-brand-100" aria-label="Layer 탐색기 펼치기" onClick={() => onCollapsedChange(false)}>L</button>
        <span className="mt-3 [writing-mode:vertical-rl] text-[11px] font-semibold tracking-widest text-muted">LAYER</span>
      </nav>
    )
  }

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2
  const end = Math.min(filtered.length, start + visibleCount)
  const visible = filtered.slice(start, end)

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = Math.max(0, filtered.findIndex((item) => item.key === activeLayerKey))
    const nextIndex = resolveLayerNavigatorIndex(event.key, currentIndex, filtered.length)
    if (nextIndex == null) return
    event.preventDefault()
    const item = filtered[nextIndex]
    if (item == null) return
    onActivate(item.key)
    listRef.current?.scrollTo({ top: nextIndex * ROW_HEIGHT - VIEWPORT_HEIGHT / 2 })
  }

  return (
    <nav className="flex h-full w-[220px] flex-col border-r border-border-subtle bg-canvas" aria-label="Layer 선택" data-layer-navigator-collapsed="false">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle px-3">
        <div><strong className="text-xs tracking-[0.12em] text-ink-950">LAYERS</strong><span className="ml-2 text-[11px] text-muted">{items.length}</span></div>
        <div className="flex items-center gap-1">
          <button type="button" className={currentOnly ? 'h-7 border border-brand-700 bg-brand-700 px-2 text-[11px] font-semibold text-white hover:bg-ink-950' : 'h-7 border border-border-control bg-surface px-2 text-[11px] font-semibold text-ink-950 hover:border-brand-700 hover:text-brand-700'} aria-pressed={currentOnly} onClick={() => onCurrentOnlyChange(!currentOnly)}>현재만</button>
          <button type="button" className="h-7 w-7 border border-transparent text-muted hover:border-border-control hover:bg-surface hover:text-ink-950" aria-label="Layer 탐색기 접기" onClick={() => onCollapsedChange(true)}>‹</button>
        </div>
      </div>
      <div className="border-b border-border-subtle p-2">
        <label className="sr-only" htmlFor="layer-navigator-search">Layer 검색</label>
        <input id="layer-navigator-search" className="input !h-8 !rounded-none !px-2 text-xs" aria-label="Layer 검색" placeholder="ID, 공정, 장비 검색" value={query} onChange={(event) => onQueryChange(event.target.value)} />
        <div className="mt-1 text-[11px] text-muted" role="status" aria-live="polite">{filtered.length}개 Layer</div>
      </div>
      {recent.length > 0 ? (
        <section className="border-b border-border-subtle px-2 py-2" aria-label="최근 Layer">
          <div className="mb-1 px-1 text-[10px] font-bold tracking-[0.12em] text-muted">최근</div>
          <div className="flex gap-1 overflow-hidden">
            {recent.map((item) => <button key={item.key} className="min-w-0 flex-1 truncate border border-border-control bg-surface px-1.5 py-1 text-[10px] hover:bg-brand-100" onClick={() => onActivate(item.key)} title={item.label}>{item.number}</button>)}
          </div>
        </section>
      ) : null}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" style={{ height: VIEWPORT_HEIGHT }} role="listbox" aria-label="전체 Layer" tabIndex={0} onKeyDown={handleKeyDown} onScroll={(event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop)}>
        <div style={{ height: start * ROW_HEIGHT }} aria-hidden="true" />
        {visible.map((item) => {
          const active = item.key === activeLayerKey
          return (
            <button key={item.key} type="button" role="option" aria-selected={active} aria-current={active ? 'true' : undefined} data-layer-row={item.key} className={`group flex h-9 w-full items-center gap-2 border-b border-border-subtle px-2 text-left text-xs hover:bg-brand-100 focus-visible:relative ${active ? 'bg-brand-100 font-semibold text-brand-700' : 'bg-transparent text-ink-950'}`} onClick={() => onActivate(item.key)} title={item.label}>
              <span className="w-7 shrink-0 font-mono text-[10px] text-muted">{item.number}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.dirty ? <span className="text-warning" aria-label="미저장">●</span> : null}
              {item.errorCount > 0 ? <span className="min-w-5 border border-error px-1 text-center text-[10px] font-bold text-error" aria-label={`오류 ${item.errorCount}건`}>{item.errorCount}</span> : null}
            </button>
          )
        })}
        <div style={{ height: (filtered.length - end) * ROW_HEIGHT }} aria-hidden="true" />
      </div>
    </nav>
  )
}
