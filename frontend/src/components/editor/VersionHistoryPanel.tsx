import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useVersionHistory } from '@/hooks/useProjects'
import type { ProjectStatus } from '@/types'

interface Props {
  projectId: number
  isOpen: boolean
  onClose: () => void
  currentProjectId: number
}

const statusLabel: Record<ProjectStatus, string> = {
  draft: 'Draft',
  review: 'Review',
  approved: 'Approved',
  rejected: 'Rejected',
  archived: 'Archived',
}

const statusBadgeClass: Record<ProjectStatus, string> = {
  draft: 'bg-blue-100 text-blue-700',
  review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  archived: 'bg-gray-100 text-gray-600',
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  } catch {
    return dateStr
  }
}

export function VersionHistoryPanel({ projectId, isOpen, onClose, currentProjectId }: Props) {
  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)
  const { data: versionData, isLoading } = useVersionHistory(projectId)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e: MouseEvent) {
      // Check both the dropdown panel AND its parent container (which holds the trigger button)
      const parentContainer = panelRef.current?.parentElement
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        (!parentContainer || !parentContainer.contains(e.target as Node))
      ) {
        onClose()
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Sort versions by revision descending (newest first)
  const versions = versionData
    ? [...versionData.versions].sort((a, b) => b.revision - a.revision)
    : []

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-1 z-50 w-80 bg-background border border-border rounded-lg shadow-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-muted/40">
        <p className="text-xs font-semibold text-foreground">
          버전 히스토리
          {versionData && (
            <span className="ml-1.5 text-muted-foreground font-normal">
              {versionData.product_name}
            </span>
          )}
        </p>
      </div>

      {/* Body */}
      <div className="max-h-72 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && versions.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            버전 정보가 없습니다.
          </div>
        )}

        {!isLoading && versions.length > 0 && (
          <ul className="divide-y divide-border">
            {versions.map((v) => {
              const isCurrent = v.project_id === currentProjectId
              const status = v.status as ProjectStatus
              return (
                <li
                  key={v.project_id}
                  className={`flex items-center gap-2 px-3 py-2 text-xs ${
                    isCurrent ? 'bg-accent/50' : 'hover:bg-muted/50'
                  }`}
                >
                  {/* Version number */}
                  <span className={`font-semibold shrink-0 ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                    v{v.revision}
                  </span>

                  {/* Status badge */}
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                      statusBadgeClass[status] ?? 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {statusLabel[status] ?? status}
                  </span>

                  {/* Creator + date */}
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-muted-foreground">
                      {v.created_by_name ?? '-'}
                    </div>
                    <div className="text-[10px] text-muted-foreground/70">
                      {formatDate(v.created_at)}
                    </div>
                  </div>

                  {/* Current label or view link */}
                  {isCurrent ? (
                    <span className="text-[10px] font-medium text-primary shrink-0">(현재)</span>
                  ) : (
                    <button
                      type="button"
                      className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline shrink-0"
                      onClick={() => {
                        onClose()
                        navigate(`/projects/${v.project_id}/edit`)
                      }}
                    >
                      보기
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
