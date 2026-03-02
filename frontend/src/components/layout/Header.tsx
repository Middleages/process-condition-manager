import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'
import { canAccessAdmin } from '@/lib/permissions'
import { LogOut, Settings, User, FolderOpen, FileCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import NotificationBell from '@/components/announcement/NotificationBell'

export default function Header() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  // admin 또는 developer 역할이면 관리자 메뉴 노출
  const showAdmin = canAccessAdmin(user?.roles)

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="h-12 bg-primary text-primary-foreground flex items-center px-5 gap-6 shrink-0">
      <Link to="/" className="font-bold text-base no-underline text-primary-foreground">
        PCM - Process Condition Manager
      </Link>

      <Link
        to="/projects"
        className="flex items-center gap-1.5 text-sm no-underline text-primary-foreground hover:text-primary-foreground/80"
      >
        <FolderOpen className="h-4 w-4" />
        프로젝트
      </Link>

      <Link
        to="/config-changes"
        className="flex items-center gap-1.5 text-sm no-underline text-primary-foreground hover:text-primary-foreground/80"
      >
        <FileCheck className="h-4 w-4" />
        변경 요청
      </Link>

      {showAdmin && (
        <Link
          to="/admin"
          className="flex items-center gap-2 text-sm no-underline text-primary-foreground hover:text-primary-foreground/80"
        >
          <Settings className="h-4 w-4" />
          관리자
        </Link>
      )}

      <div className="flex-1" />

      {user && (
        <div className="flex items-center gap-3">
          <NotificationBell />
          <div className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4" />
            <span>{user.display_name}</span>
            {/* 다중 역할 배지 표시 */}
            <div className="flex gap-1">
              {user.roles.map((r) => (
                <span
                  key={r}
                  className="px-1.5 py-0.5 rounded text-xs bg-primary-foreground/20 font-medium"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground h-7 px-2"
            aria-label="로그아웃"
          >
            <LogOut className="h-4 w-4" />
            <span className="ml-1 text-xs">로그아웃</span>
          </Button>
        </div>
      )}
    </header>
  )
}
