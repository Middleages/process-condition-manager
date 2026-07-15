import { useEffect } from 'react'
import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom'

export function RootLayout() {
  const { pathname } = useLocation()

  useEffect(() => {
    document.querySelector<HTMLElement>('[data-page-title]')?.focus()
  }, [pathname])

  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  )
}
