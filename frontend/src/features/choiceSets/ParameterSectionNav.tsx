import { NavLink } from 'react-router-dom'

const items = [
  { to: '/parameters', label: '파라미터', end: true },
  { to: '/parameters/choice-sets', label: '선택지 집합', end: false },
]

export function ParameterSectionNav() {
  return (
    <nav
      aria-label="파라미터 관리 섹션"
      className="min-w-0 overflow-x-auto border-b border-border-subtle"
    >
      <div className="flex min-w-max items-center gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            end={item.end}
            to={item.to}
            className={({ isActive }) =>
              [
                'inline-flex h-10 items-center border-b-2 px-3 text-sm font-semibold transition-colors',
                isActive
                  ? 'border-brand-700 text-brand-700'
                  : 'border-transparent text-muted hover:text-ink-950',
              ].join(' ')
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
