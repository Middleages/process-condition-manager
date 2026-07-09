import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

export function AppLayout() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-700">PCM</p>
            <h1 className="text-xl font-semibold">Process Condition Manager</h1>
          </div>
          <nav className="flex gap-2">
            <NavItem to="/projects">프로젝트</NavItem>
            <NavItem to="/parameters">파라미터 관리</NavItem>
            <NavItem to="/processes">공정/layer 확인</NavItem>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}

function NavItem({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'rounded-lg px-3 py-2 text-sm font-medium transition',
          isActive ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  )
}
