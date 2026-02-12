import { Link } from 'react-router-dom'
import { useUsers } from '@/hooks/useUsers'
import { useUserStore } from '@/stores/useUserStore'
import { User } from 'lucide-react'

export default function Header() {
  const { data: users = [] } = useUsers()
  const currentUserId = useUserStore((s) => s.currentUserId)
  const setCurrentUserId = useUserStore((s) => s.setCurrentUserId)

  return (
    <header className="h-12 bg-primary text-primary-foreground flex items-center px-5 gap-6 shrink-0">
      <Link to="/projects" className="font-bold text-base no-underline text-primary-foreground">
        PCM - Process Condition Manager
      </Link>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <User className="h-4 w-4" />
        <select
          className="bg-primary text-primary-foreground border border-primary-foreground/30 rounded px-2 py-1 text-sm focus:outline-none"
          value={currentUserId ?? ''}
          onChange={(e) => setCurrentUserId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">사용자 선택</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name} ({u.role})
            </option>
          ))}
        </select>
      </div>
    </header>
  )
}
