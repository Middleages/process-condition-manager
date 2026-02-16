import { Outlet, Link, useLocation, Navigate } from 'react-router-dom'
import { useUsers } from '@/hooks/useUsers'
import { useUserStore } from '@/stores/useUserStore'

export default function AdminLayout() {
  const { data: users = [] } = useUsers()
  const currentUserId = useUserStore((s) => s.currentUserId)
  const location = useLocation()

  // Find current user
  const currentUser = users.find((u) => u.id === currentUserId)

  // Redirect to projects if not admin
  if (currentUserId && currentUser && currentUser.role !== 'admin') {
    return <Navigate to="/projects" replace />
  }

  const tabs = [
    { path: '/admin/xml-mappings', label: 'XML 매핑 관리' },
    { path: '/admin/validations', label: '검증 규칙 관리' },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab Navigation */}
      <div className="border-b border-border">
        <div className="flex gap-1 px-6">
          {tabs.map((tab) => {
            const isActive = location.pathname === tab.path
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
