import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Header from './Header'
import { useAuthStore } from '@/stores/useAuthStore'
import { useLines } from '@/hooks/useLines'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import client from '@/api/client'

export default function Layout() {
  const user = useAuthStore((s) => s.user)
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser)
  const showLineWarning = user != null && user.line_id == null

  const { data: lines = [] } = useLines()
  const [selectedLineId, setSelectedLineId] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)

  const handleSetLine = async () => {
    if (!selectedLineId) return
    setIsSaving(true)
    try {
      await client.patch('/auth/me/line', { line_id: Number(selectedLineId) })
      await fetchCurrentUser()
    } catch {
      // 에러는 client interceptor에서 처리
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <Header />
      {showLineWarning && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-2.5 flex items-center gap-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>소속 라인을 설정해 주세요. 라인 미설정 시 설정 변경 요청에 투표할 수 없습니다.</span>
          <select
            value={selectedLineId}
            onChange={(e) => setSelectedLineId(e.target.value)}
            className="ml-auto px-2 py-1 rounded border border-amber-300 bg-white text-sm"
          >
            <option value="">라인 선택</option>
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.line_name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSetLine}
            disabled={!selectedLineId || isSaving}
            className="border-amber-400 text-amber-800 hover:bg-amber-100"
          >
            {isSaving ? '저장 중...' : '설정'}
          </Button>
        </div>
      )}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
