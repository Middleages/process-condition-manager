interface FilterState {
  layerId: string | null
  changeType: string | null
  userId: number | null
}

interface ChangeHistoryFiltersProps {
  layers: Array<{ id: string; name: string }>
  users: Array<{ id: number; name: string }>
  filters: FilterState
  onFilterChange: (filters: FilterState) => void
}

const CHANGE_TYPE_OPTIONS = [
  { value: 'manual', label: '수동' },
  { value: 'backbone', label: 'Backbone' },
  { value: 'recipe', label: 'Recipe' },
  { value: 'status_change', label: '상태 변경' },
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
            layerId: e.target.value || null,
          })
        }
      >
        <option value="">전체 레이어</option>
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
        <option value="">전체 유형</option>
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
        <option value="">전체 사용자</option>
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
