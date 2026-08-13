import { Link, NavLink, Outlet } from 'react-router-dom'

const primaryNavigation = [
  { to: '/projects', code: 'PRJ', label: '프로젝트' },
  { to: '/processes', code: 'PCS', label: '공정 카탈로그' },
  { to: '/parameters', code: 'PAR', label: '파라미터 관리' },
]

export function AppLayout() {
  const navigationItems = import.meta.env.DEV
    ? [...primaryNavigation, { to: '/grid-demo', code: 'GRID', label: '그리드 데모' }]
    : primaryNavigation

  return (
    <div className="grid min-h-dvh grid-cols-[76px_minmax(0,1fr)] bg-canvas text-ink-950">
      <a
        className="skip-link fixed left-4 top-2 z-50 -translate-y-16 rounded-[3px] bg-ink-950 px-3 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
        href="#main-content"
      >
        본문으로 건너뛰기
      </a>
      <aside className="w-[76px] border-r border-border-subtle bg-surface">
        <div className="flex h-full flex-col items-stretch py-3">
          <Link
            className="mb-5 inline-flex h-10 items-center justify-center rounded-[3px] font-bold tracking-[0.12em] text-ink-950"
            to="/projects"
            aria-label="PCM 프로젝트"
          >
            PCM
          </Link>
          <nav aria-label="주요 메뉴" className="flex flex-col gap-1 px-2">
            {navigationItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                aria-label={item.label}
                className={({ isActive }) =>
                  [
                    'inline-flex h-11 items-center justify-center rounded-[3px] text-xs font-bold tracking-[0.08em] transition-colors',
                    isActive
                      ? 'bg-brand-700 text-white'
                      : 'text-muted hover:bg-canvas hover:text-ink-950',
                  ].join(' ')
                }
              >
                {item.code}
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>
      <main id="main-content" className="min-w-0 w-full px-4 py-6 md:px-6 xl:px-8" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}
