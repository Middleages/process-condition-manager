import { useEffect } from 'react'
import { useCellHistory } from '../../hooks/useProjects'
import { Loader2, X } from 'lucide-react'

interface CellHistoryModalProps {
  projectId: number
  projectLayerId: number
  columnName: string
  layerName: string
  onClose: () => void
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  manual: 'Manual',
  backbone: 'Backbone',
  recipe: 'Recipe',
}

function formatChangedAt(timestamp: string): string {
  const d = new Date(timestamp)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${month}/${day} ${hh}:${mm}`
}

export function CellHistoryModal({
  projectId,
  projectLayerId,
  columnName,
  layerName,
  onClose,
}: CellHistoryModalProps) {
  const { data, isLoading } = useCellHistory(projectId, projectLayerId, columnName)

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      {/* Modal panel — stop propagation so clicks inside don't close */}
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 flex flex-col"
        style={{ maxHeight: '500px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 py-3 border-b shrink-0">
          <div>
            <h2 className="text-sm font-semibold">Cell History: {columnName}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Layer: {layerName}</p>
          </div>
          <button
            className="text-muted-foreground hover:text-foreground ml-4"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-12">
              No change history for this cell.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="border-b">
                  <th className="text-left px-3 py-2 font-medium w-24">Time</th>
                  <th className="text-left px-3 py-2 font-medium w-24">User</th>
                  <th className="text-left px-3 py-2 font-medium w-20">Type</th>
                  <th className="text-left px-3 py-2 font-medium">Old Value</th>
                  <th className="text-left px-3 py-2 font-medium">New Value</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-muted-foreground font-mono">
                      {formatChangedAt(item.changed_at)}
                    </td>
                    <td className="px-3 py-1.5">{item.changed_by_userid}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`px-1 py-0.5 rounded text-[10px] ${
                          item.change_type === 'manual'
                            ? 'bg-blue-100 text-blue-700'
                            : item.change_type === 'backbone'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {CHANGE_TYPE_LABELS[item.change_type] ?? item.change_type}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-destructive/70 line-through">
                      {item.old_value ?? '--'}
                    </td>
                    <td className="px-3 py-1.5 text-green-600 font-medium">
                      {item.new_value ?? '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t shrink-0">
          <span className="text-xs text-muted-foreground">
            {data ? `${data.total} changes total` : ''}
          </span>
          <button
            className="text-xs px-3 py-1.5 border border-border rounded hover:bg-muted/50 transition-colors"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
