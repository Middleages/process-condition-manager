import { Outlet } from 'react-router-dom'
import Header from './Header'
import { useAuthStore } from '@/stores/useAuthStore'
import { hasAnyRole } from '@/lib/permissions'
import { AlertTriangle } from 'lucide-react'

export default function Layout() {
  const user = useAuthStore((s) => s.user)
  const showLineWarning =
    user != null &&
    user.line_id == null &&
    hasAnyRole(user.roles, ['reviewer', 'admin'])

  return (
    <div className="flex flex-col h-screen">
      <Header />
      {showLineWarning && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-2 flex items-center gap-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            소속 라인이 설정되지 않았습니다. 관리자에게 요청하여 프로필에 소속 라인을 설정해 주세요.
            라인 미설정 시 설정 변경 요청에 투표할 수 없습니다.
          </span>
        </div>
      )}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
