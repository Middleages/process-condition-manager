interface GridContextMenuProps {
  x: number
  y: number
  projectLayerId: number
  layerName: string
  columnName: string
  columnDisplayName: string
  projectStatus?: string
  currentUserRole?: string
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
  currentUserRole,
  onViewHistory,
  onAddComment,
  onClose,
}: GridContextMenuProps) {
  return (
    <div
      className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[160px]"
      style={{ left: x, top: y }}
    >
      <button
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 flex items-center gap-2"
        onClick={() => {
          onViewHistory?.(projectLayerId, layerName, columnName)
          onClose()
        }}
      >
        <span className="text-gray-500">&#128203;</span>
        View History
      </button>
      {projectStatus === 'review' && (currentUserRole === 'reviewer' || currentUserRole === 'admin') && (
        <button
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
