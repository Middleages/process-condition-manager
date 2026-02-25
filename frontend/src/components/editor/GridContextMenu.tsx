import { hasAnyRole } from '@/lib/permissions'
import type { UserRole } from '@/types/user'

interface GridContextMenuProps {
  x: number
  y: number
  projectLayerId: number
  layerName: string
  columnName: string
  columnDisplayName: string
  projectStatus?: string
  // 다중 역할 배열로 전환
  currentUserRoles?: string[]
  onViewHistory?: (projectLayerId: number, layerName: string, columnName: string) => void
  onAddComment?: (projectLayerId: number, layerName: string, columnName: string, columnDisplayName: string) => void
  onClose: () => void
}

export function GridContextMenu({
  x,
  y,
  projectLayerId,
  layerName,
  columnName,
  columnDisplayName,
  projectStatus,
  currentUserRoles,
  onViewHistory,
  onAddComment,
  onClose,
}: GridContextMenuProps) {
  // review 상태에서 reviewer 또는 admin 역할이면 댓글 추가 메뉴 노출
  const canAddComment =
    projectStatus === 'review' &&
    hasAnyRole(currentUserRoles as UserRole[], ['reviewer', 'admin'])

  return (
    <div
      role="menu"
      className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[160px]"
      style={{ left: x, top: y }}
    >
      <button
        role="menuitem"
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 flex items-center gap-2"
        onClick={() => {
          onViewHistory?.(projectLayerId, layerName, columnName)
          onClose()
        }}
      >
        <span className="text-gray-500">&#128203;</span>
        View History
      </button>
      {canAddComment && (
        <button
          role="menuitem"
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 flex items-center gap-2"
          onClick={() => {
            onAddComment?.(projectLayerId, layerName, columnName, columnDisplayName)
            onClose()
          }}
        >
          <span className="text-gray-500">&#128172;</span>
          Add Comment
        </button>
      )}
    </div>
  )
}
