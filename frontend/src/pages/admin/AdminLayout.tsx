import { Outlet, Link, useLocation, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'
import { canAccessAdmin, canAccessTab, hasRole } from '@/lib/permissions'
import type { UserRole } from '@/types/user'

export default function AdminLayout() {
  const currentUser = useAuthStore((s) => s.user)
  const location = useLocation()

  // 인증 사용자가 admin/developer 역할이 아니면 공정 조건표 목록으로 리다이렉트
  if (currentUser && !canAccessAdmin(currentUser.roles)) {
    return <Navigate to="/process-conditions" replace />
  }

  const tabs = [
    { path: '/admin/users', label: '사용자 관리' },
    { path: '/admin/master-data', label: '마스터 데이터 관리' },
    { path: '/admin/device-masters', label: '디바이스 마스터' },
    { path: '/admin/enum-options', label: '선택 옵션 관리' },
    { path: '/admin/xml-mappings', label: 'XML 매핑 관리' },
    { path: '/admin/validations', label: '검증 규칙 관리' },
    { path: '/admin/data-sources', label: '데이터 소스 관리' },
    { path: '/admin/export-systems', label: '전산 출력 시스템 관리' },
    { path: '/admin/audit-logs', label: '변경 이력 조회' },
    { path: '/admin/announcements', label: '공지사항 관리' },
  ]

  const userRoles = currentUser?.roles as UserRole[] | undefined

  // 현재 사용자가 접근 가능한 탭만 필터링
  const visibleTabs = tabs.filter((tab) => canAccessTab(userRoles, tab.path))

  // /admin 인덱스 라우트 기본 리다이렉트: admin -> /admin/users, developer(no admin) -> 첫 번째 가용 탭
  if (location.pathname === '/admin') {
    if (hasRole(userRoles, 'admin')) {
      return <Navigate to="/admin/users" replace />
    }
    // developer(admin 아님)인 경우 사용자 관리 탭 제외 첫 번째 가용 탭으로
    const firstTab = visibleTabs.find((t) => t.path !== '/admin/users')
    if (firstTab) {
      return <Navigate to={firstTab.path} replace />
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab Navigation */}
      <div className="border-b border-border shrink-0">
        <div className="flex gap-1 px-6 overflow-x-auto">
          {visibleTabs.map((tab) => {
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
