import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'

/**
 * ProtectedRoute guards routes that require authentication.
 *
 * Behavior:
 * - If isLoading: show a loading spinner
 * - If isAuthenticated: render the child routes via <Outlet />
 * - Otherwise: redirect to /login?redirect={current pathname}
 */
export default function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuthStore()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
          aria-label="로딩 중"
          role="status"
        />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(location.pathname)}`}
        replace
      />
    )
  }

  return <Outlet />
}
