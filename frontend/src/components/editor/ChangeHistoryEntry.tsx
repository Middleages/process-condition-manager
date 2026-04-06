import type { TimelineEntry } from '../../types'

interface ChangeHistoryEntryProps {
  entry: TimelineEntry
  onClick?: (entry: TimelineEntry) => void
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function getChangeTypeStyle(changeType: string | undefined): {
  label: string
  icon: string
  color: string
} {
  switch (changeType) {
    case 'manual':
      return { label: 'Manual Edit', icon: '\u270F\uFE0F', color: 'text-blue-500' }
    case 'backbone':
      return { label: 'Backbone', icon: '\uD83D\uDD17', color: 'text-purple-500' }
    case 'recipe':
      return { label: 'Recipe', icon: '\uD83D\uDCC4', color: 'text-green-500' }
    default:
      return { label: changeType ?? 'Edit', icon: '\u270F\uFE0F', color: 'text-blue-500' }
  }
}

export function ChangeHistoryEntry({ entry, onClick }: ChangeHistoryEntryProps) {
  const isCellChange = entry.entry_type === 'cell_change'
  const { details } = entry

  if (isCellChange) {
    const typeStyle = getChangeTypeStyle(details.change_type)
    const isClickable = !!onClick

    return (
      <div
        className={`px-3 py-2 border-b border-border/30 text-xs ${
          isClickable ? 'cursor-pointer hover:bg-muted/30' : ''
        }`}
        onClick={isClickable ? () => onClick(entry) : undefined}
      >
        {/* Time and user row */}
        <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
          <span className="font-mono">{formatTime(entry.timestamp)}</span>
          <span>{entry.userid}</span>
        </div>

        {/* Action type row */}
        <div className={`flex items-center gap-1 font-medium mb-0.5 ${typeStyle.color}`}>
          <span>{typeStyle.icon}</span>
          <span>{typeStyle.label}</span>
        </div>

        {/* Layer and column */}
        <div className="text-muted-foreground mb-0.5">
          {details.layer_name ?? '-'} &middot; {details.column_name ?? '-'}
        </div>

        {/* Value change */}
        <div className="flex items-center gap-1">
          <span className="text-destructive/70 line-through">
            {details.old_value ?? '--'}
          </span>
          <span className="text-muted-foreground">&rarr;</span>
          <span className="text-green-600 font-medium">
            {details.new_value ?? '--'}
          </span>
        </div>
      </div>
    )
  }

  // status_change
  return (
    <div className="px-3 py-2 border-b border-border/30 text-xs">
      {/* Time and user row */}
      <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
        <span className="font-mono">{formatTime(entry.timestamp)}</span>
        <span>{entry.userid}</span>
      </div>

      {/* Action type row */}
      <div className="flex items-center gap-1 font-medium mb-0.5 text-orange-500">
        <span>&#128681;</span>
        <span>Status Change</span>
      </div>

      {/* Status transition */}
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-muted-foreground">{details.from_status ?? '-'}</span>
        <span className="text-muted-foreground">&rarr;</span>
        <span className="font-medium">{details.to_status ?? '-'}</span>
      </div>

      {/* Optional comment */}
      {details.comment && (
        <div className="text-muted-foreground italic truncate">{details.comment}</div>
      )}
    </div>
  )
}
