import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTimeline } from '@/hooks/useProjects'
import type { ProjectLayerData, TimelineGroup, TimelineEntry } from '@/types'
import type { FilterState } from './ChangeHistoryFilters'
import { ChangeHistoryFilters } from './ChangeHistoryFilters'
import { ChangeHistoryEntry } from './ChangeHistoryEntry'
import { History, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  projectId: number
  layers: ProjectLayerData[]
  isOpen: boolean
  onClose: () => void
  onNavigateToCell?: (layerName: string, columnName: string) => void
}

function mergeGroups(existing: TimelineGroup[], incoming: TimelineGroup[]): TimelineGroup[] {
  const merged = [...existing]
  for (const ng of incoming) {
    const existingGroup = merged.find((g) => g.date === ng.date)
    if (existingGroup) {
      existingGroup.entries = [...existingGroup.entries, ...ng.entries]
    } else {
      merged.push(ng)
    }
  }
  return merged
}

export function ChangeHistoryPanel({
  projectId,
  layers,
  isOpen,
  onClose,
  onNavigateToCell,
}: Props) {
  const [page, setPage] = useState(1)
  const [accumulatedGroups, setAccumulatedGroups] = useState<TimelineGroup[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [filters, setFilters] = useState<FilterState>({
    layerId: null,
    changeType: null,
    userId: null,
  })

  // Status filter is client-side only; other change_types go to backend
  const apiChangeType =
    filters.changeType && filters.changeType !== 'status_change'
      ? filters.changeType
      : undefined

  const { data, isLoading, isFetching } = useTimeline(projectId, {
    page,
    limit: 50,
    layer_id: filters.layerId ?? undefined,
    change_type: apiChangeType,
    changed_by: filters.userId ?? undefined,
  })

  // Merge incoming page data
  useEffect(() => {
    if (data) {
      setTotalItems(data.total)
      if (page === 1) {
        setAccumulatedGroups(data.groups)
      } else {
        setAccumulatedGroups((prev) => mergeGroups(prev, data.groups))
      }
    }
  }, [data, page])

  // Reset on filter change
  const handleFilterChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters)
    setPage(1)
    setAccumulatedGroups([])
  }, [])

  // Client-side status_change filter
  const displayGroups = useMemo(() => {
    if (filters.changeType !== 'status_change') return accumulatedGroups
    return accumulatedGroups
      .map((g) => ({
        ...g,
        entries: g.entries.filter((e) => e.entry_type === 'status_change'),
      }))
      .filter((g) => g.entries.length > 0)
  }, [accumulatedGroups, filters.changeType])

  const loadedCount = accumulatedGroups.reduce(
    (sum, g) => sum + g.entries.length,
    0
  )
  const hasMore = loadedCount < totalItems
  const displayedCount = displayGroups.reduce(
    (sum, g) => sum + g.entries.length,
    0
  )

  // Extract distinct users from accumulated data for filter dropdown
  const distinctUsers = useMemo(() => {
    const userMap = new Map<number, string>()
    for (const group of accumulatedGroups) {
      for (const entry of group.entries) {
        if (!userMap.has(entry.user_id)) {
          userMap.set(entry.user_id, entry.user_name)
        }
      }
    }
    return Array.from(userMap.entries()).map(([id, name]) => ({ id, name }))
  }, [accumulatedGroups])

  // Map layers for filter dropdown
  const layerOptions = useMemo(
    () => layers.map((l) => ({ id: l.layer_id, name: l.layer_name })),
    [layers]
  )

  const handleEntryClick = useCallback(
    (entry: TimelineEntry) => {
      if (
        entry.entry_type === 'cell_change' &&
        entry.details.layer_name &&
        entry.details.column_name &&
        onNavigateToCell
      ) {
        onNavigateToCell(entry.details.layer_name, entry.details.column_name)
      }
    },
    [onNavigateToCell]
  )

  if (!isOpen) return null

  return (
    <div className="w-[350px] shrink-0 border-l flex flex-col h-full bg-background overflow-hidden transition-all duration-200">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <History className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium flex-1">
          Change History
          {totalItems > 0 && (
            <span className="text-muted-foreground font-normal ml-1">
              ({totalItems})
            </span>
          )}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters */}
      <div className="px-3 py-2 border-b">
        <ChangeHistoryFilters
          layers={layerOptions}
          users={distinctUsers}
          filters={filters}
          onFilterChange={handleFilterChange}
        />
      </div>

      {/* Timeline Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && page === 1 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-xs">로딩 중...</span>
          </div>
        ) : displayGroups.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            변경 이력이 없습니다.
          </div>
        ) : (
          <>
            {displayGroups.map((group) => (
              <div key={group.date}>
                {/* Date header */}
                <div className="sticky top-0 z-10 px-3 py-1.5 bg-muted/50 border-b text-xs font-medium text-muted-foreground">
                  {group.date}
                </div>
                {/* Entries */}
                {group.entries.map((entry) => (
                  <ChangeHistoryEntry
                    key={entry.id}
                    entry={entry}
                    onClick={
                      entry.entry_type === 'cell_change'
                        ? handleEntryClick
                        : undefined
                    }
                  />
                ))}
              </div>
            ))}

            {/* Load More */}
            {hasMore && (
              <div className="px-3 py-3 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs w-full"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={isFetching}
                >
                  {isFetching ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      로딩 중...
                    </>
                  ) : filters.changeType === 'status_change'
                    ? `더 보기 (${displayedCount}건 표시 중)`
                    : `더 보기 (${loadedCount} / ${totalItems})`
                  }
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
