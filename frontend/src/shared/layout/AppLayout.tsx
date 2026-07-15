import type { ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'

const primaryNavigation = [
  { to: '/projects', label: '프로젝트' },
  { to: '/processes', label: '공정 카탈로그' },
  { to: '/parameters', label: '파라미터 관리' },
]

export function AppLayout() {
  return (
    <div className="min-h-dvh bg-canvas text-ink-950">
      <a
        className="skip-link fixed left-4 top-2 z-50 -translate-y-16 rounded-md bg-ink-950 px-3 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
        href="#main-content"
      >
        본문으로 건너뛰기
      </a>
      <header className="h-[52px] border-b border-border-subtle bg-surface">
        <div className="flex h-full w-full items-center justify-between px-4 md:px-6 xl:px-8">
          <Link
            className="inline-flex h-9 items-center rounded-md font-bold tracking-[0.12em] text-ink-950"
            to="/projects"
            aria-label="PCM 프로젝트"
          >
            PCM
          </Link>

          <nav aria-label="주요 메뉴" className="hidden h-full items-center lg:flex">
            <NavigationItems />
          </nav>

          <details className="relative lg:hidden">
            <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-md border border-border-control bg-surface px-3 text-sm font-semibold text-ink-950 hover:bg-canvas [&::-webkit-details-marker]:hidden">
              메뉴
            </summary>
            <nav
              aria-label="좁은 화면 주요 메뉴"
              className="absolute right-0 top-[calc(100%+0.5rem)] z-40 min-w-52 overflow-hidden rounded-lg border border-border-subtle bg-surface p-1 shadow-lg"
            >
              <NavigationItems compact />
            </nav>
          </details>
        </div>
      </header>
      <main id="main-content" className="w-full px-4 py-6 md:px-6 xl:px-8" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}

function NavigationItems({ compact = false }: { compact?: boolean }) {
  const items = import.meta.env.DEV
    ? [...primaryNavigation, { to: '/grid-demo', label: '그리드 데모' }]
    : primaryNavigation

  return items.map((item) => (
    <NavItem key={item.to} to={item.to} compact={compact}>
      {item.label}
    </NavItem>
  ))
}

function NavItem({
  to,
  compact,
  children,
}: {
  to: string
  compact: boolean
  children: ReactNode
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        compact
          ? [
              'flex min-h-9 items-center rounded-md border-l-2 px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-brand-700 bg-brand-100 text-brand-700'
                : 'border-transparent text-muted hover:bg-canvas hover:text-ink-950',
            ].join(' ')
          : [
              'inline-flex h-[52px] items-center border-b-2 px-3 text-sm font-medium transition-colors',
              isActive
                ? 'border-brand-700 text-brand-700'
                : 'border-transparent text-muted hover:text-ink-950',
            ].join(' ')
      }
    >
      {children}
    </NavLink>
  )
}
