import { useMemo, useRef, useState } from 'react'

import { GlideConditionGrid, type ConditionGridHandle } from '@/grid'
import { distinctCategories } from '@/grid/model'

import { makeDemoSheet } from './demoData'

/**
 * 합성 데이터(60행 × 200컬럼) 데모 — dev 전용 라우트 `/grid-demo`.
 *
 * 어댑터의 렌더/스크롤/그룹핑/카테고리 필터/컬럼 검색-점프/붙여넣기 훅을 백엔드 없이
 * 체감·검증한다(D-18 확인 게이트, EC2). 편집/저장/스테이징 파이프라인은 T3/T4가 붙인다.
 */
export function GridDemoPage() {
  const data = useMemo(() => makeDemoSheet(), [])
  const categories = useMemo(() => distinctCategories(data.columns), [data.columns])
  const gridRef = useRef<ConditionGridHandle>(null)

  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [columnQuery, setColumnQuery] = useState('')
  const [dirtyCount, setDirtyCount] = useState(0)
  const [lastPaste, setLastPaste] = useState<string | null>(null)

  const visibleCount = useMemo(
    () =>
      activeCategory === null
        ? data.columns.length
        : data.columns.filter((column) => column.categoryCode === activeCategory).length,
    [data.columns, activeCategory],
  )

  const jumpToColumn = () => {
    const query = columnQuery.trim().toUpperCase()
    if (query === '') return
    const match = data.columns.find((column) => column.key.toUpperCase().includes(query))
    if (match) gridRef.current?.scrollToColumn(match.key)
  }

  return (
    <section className="space-y-4">
      <div>
        <p className="text-sm text-cyan-700">Phase 2 · T2 그리드 어댑터 (D-18 확인)</p>
        <h2 className="text-2xl font-semibold">그리드 데모 (합성 60행 × 200컬럼)</h2>
        <p className="mt-2 text-sm text-slate-500">
          Glide Data Grid 어댑터의 동적 컬럼 · 컬럼 고정 · 조건 행 그룹핑 · 카테고리 필터 · 컬럼
          검색-점프 · 엑셀 붙여넣기 훅을 백엔드 없이 확인한다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="category-tabs">
        <CategoryTab active={activeCategory === null} onClick={() => setActiveCategory(null)}>
          전체
        </CategoryTab>
        {categories.map((category) => (
          <CategoryTab
            key={category}
            active={activeCategory === category}
            onClick={() => setActiveCategory(category)}
          >
            {category}
          </CategoryTab>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <input
            className="input w-56"
            placeholder="컬럼 검색 (예: ETCH_P012)"
            value={columnQuery}
            data-testid="column-search"
            onChange={(event) => setColumnQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') jumpToColumn()
            }}
          />
          <button type="button" className="btn-secondary" data-testid="column-jump" onClick={jumpToColumn}>
            컬럼 점프
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600" data-testid="grid-stats">
        <span>
          행 <strong>{data.rows.length}</strong>
        </span>
        <span>
          보이는 컬럼 <strong>{visibleCount}</strong> / {data.columns.length}
        </span>
        <span>
          더티 편집 <strong data-testid="dirty-count">{dirtyCount}</strong>
        </span>
        <span data-testid="paste-indicator">붙여넣기: {lastPaste ?? '없음'}</span>
      </div>

      <div
        className="h-[70vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        data-testid="grid-demo-grid"
      >
        <GlideConditionGrid
          ref={gridRef}
          data={data}
          view={{ activeCategory }}
          callbacks={{
            onCellEdit: () => setDirtyCount((count) => count + 1),
            onPaste: (target, tsv) => {
              const rowCount = tsv.split('\n').length
              setLastPaste(`${target.parameterCode} @ 조건 ${target.conditionId} ← ${rowCount}행 TSV`)
            },
          }}
        />
      </div>
    </section>
  )
}

function CategoryTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-lg px-3 py-1.5 text-sm font-medium transition',
        active ? 'bg-cyan-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
