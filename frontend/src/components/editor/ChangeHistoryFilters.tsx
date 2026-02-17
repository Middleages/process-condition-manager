interface FilterState {
  layerId: number | null
  changeType: string | null
  userId: number | null
}

interface ChangeHistoryFiltersProps {
  layers: Array<{ id: number; name: string }>
  users: Array<{ id: number; name: string }>
  filters: FilterState
  onFilterChange: (filters: FilterState) => void
}

const CHANGE_TYPE_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'backbone', label: 'Backbone' },
  { value: 'recipe', label: 'Recipe' },
  { value: 'status_change', label: 'Status' },
]

export function ChangeHistoryFilters({
  layers,
  users,
  filters,
  onFilterChange,
}: ChangeHistoryFiltersProps) {
  const selectClass =
    'text-xs border border-gray-300 rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary'

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* Layer filter */}
      <select
        className={selectClass}
        value={filters.layerId ?? ''}
        onChange={(e) =>
          onFilterChange({
            ...filters,
            layerId: e.target.value ? Number(e.target.value) : null,
          })
        }
      >
        <option value="">All Layers</option>
        {layers.map((layer) => (
          <option key={layer.id} value={layer.id}>
            {layer.name}
          </option>
        ))}
      </select>

      {/* Type filter */}
      <select
        className={selectClass}
        value={filters.changeType ?? ''}
        onChange={(e) =>
          onFilterChange({
            ...filters,
            changeType: e.target.value || null,
          })
        }
      >
        <option value="">All Types</option>
        {CHANGE_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* User filter */}
      <select
        className={selectClass}
        value={filters.userId ?? ''}
        onChange={(e) =>
          onFilterChange({
            ...filters,
            userId: e.target.value ? Number(e.target.value) : null,
          })
        }
      >
        <option value="">All Users</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
    </div>
  )
}

export type { FilterState }
