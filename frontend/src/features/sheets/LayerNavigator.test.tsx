import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LayerNavigator } from './LayerNavigator'
import type { LayerNavigatorItem } from './layerNavigatorState'

const items: LayerNavigatorItem[] = Array.from({ length: 100 }, (_, index) => ({
  key: `layer-${index + 1}`,
  number: String(index + 1).padStart(2, '0'),
  label: `L${index + 1} · S${index + 1} · 식각 장비`,
  searchText: `layer-${index + 1} 식각 장비`,
  sortOrder: index,
  errorCount: index === 2 ? 4 : 0,
  dirty: index === 1,
}))

describe('LayerNavigator', () => {
  it('renders an accessible, windowed, one-click layer list', () => {
    const html = renderToStaticMarkup(
      <LayerNavigator
        items={items}
        activeLayerKey="layer-3"
        recentLayerKeys={['layer-3', 'layer-2']}
        query=""
        collapsed={false}
        currentOnly={false}
        onQueryChange={() => undefined}
        onActivate={() => undefined}
        onCollapsedChange={() => undefined}
        onCurrentOnlyChange={() => undefined}
      />,
    )

    expect(html).toContain('aria-label="Layer 선택"')
    expect(html).toContain('aria-label="Layer 검색"')
    expect(html).toContain('100개 Layer')
    expect(html).toContain('최근')
    expect(html).toContain('aria-current="true"')
    expect(html).toContain('오류 4건')
    expect(html).toContain('미저장')
    expect(html).toContain('class="text-warning" aria-label="미저장"')
    expect(html.match(/data-layer-row=/g)?.length).toBeLessThan(30)
  })

  it('renders the current-Layer toggle as unselected', () => {
    const html = renderToStaticMarkup(
      <LayerNavigator
        items={items}
        activeLayerKey="layer-3"
        recentLayerKeys={[]}
        query=""
        collapsed={false}
        currentOnly={false}
        onQueryChange={() => undefined}
        onActivate={() => undefined}
        onCollapsedChange={() => undefined}
        onCurrentOnlyChange={() => undefined}
      />,
    )

    expect(html).toContain('현재만')
    expect(html).toContain('aria-pressed="false"')
  })

  it('renders a compact rail when collapsed', () => {
    const html = renderToStaticMarkup(
      <LayerNavigator
        items={items}
        activeLayerKey="layer-3"
        recentLayerKeys={[]}
        query=""
        collapsed
        currentOnly={false}
        onQueryChange={() => undefined}
        onActivate={() => undefined}
        onCollapsedChange={() => undefined}
        onCurrentOnlyChange={() => undefined}
      />,
    )
    expect(html).toContain('data-layer-navigator-collapsed="true"')
    expect(html).toContain('aria-label="Layer 탐색기 펼치기"')
  })
})
