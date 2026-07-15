import { Outlet } from 'react-router-dom'

/** Route-level shell for viewport-owned work surfaces such as the condition sheet. */
export function FocusLayout() {
  return (
    <div className="h-dvh min-h-0 min-w-0 overflow-hidden bg-canvas text-ink-950">
      <a
        className="skip-link fixed left-4 top-1 z-50 -translate-y-14 rounded-md bg-surface px-3 py-2 text-sm font-semibold text-ink-950 shadow-lg transition-transform focus:translate-y-0"
        href="#main-content"
      >
        조건표로 건너뛰기
      </a>
      <main id="main-content" className="h-full min-h-0 min-w-0" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}
