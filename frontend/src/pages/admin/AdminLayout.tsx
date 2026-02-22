import { Outlet, Link, useLocation, Navigate } from 'react-router-dom'
import { useUsers } from '@/hooks/useUsers'
import { useAuthStore } from '@/stores/useAuthStore'

export default function AdminLayout() {
  const { data: users = [] } = useUsers()
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const location = useLocation()

  // Find current user
  const currentUser = users.find((u) => u.id === currentUserId)

  // Redirect to projects if not admin
  if (currentUserId && currentUser && currentUser.role !== 'admin') {
    return <Navigate to="/projects" replace />
  }

  const tabs = [
    { path: '/admin/users', label: '사용자 관리' },
    { path: '/admin/master-data', label: '마스터 데이터 관리' },
    { path: '/admin/enum-options', label: '선택 옵션 관리' },
    { path: '/admin/xml-mappings', label: 'XML 매핑 관리' },
    { path: '/admin/validations', label: '검증 규칙 관리' },
    { path: '/admin/data-sources', label: '데이터 소스 관리' },
    { path: '/admin/export-systems', label: '전산 출력 시스템 관리' },
    { path: '/admin/audit-logs', label: '변경 이력 조회' },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Tab Navigation */}
      <div className="border-b border-border shrink-0">
        <div className="flex gap-1 px-6 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = location.pathname === tab.path
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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
