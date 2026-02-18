import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useVersionHistory, useVersionDiff } from '@/hooks/useProjects'
import type { ProjectStatus, VersionItem } from '@/types'
import { VersionDiffView } from './VersionDiffView'

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

// 버전 항목 하나와 그 다음 버전(successor) 간의 diff를 보여주는 서브 컴포넌트
interface VersionDiffRowProps {
  version: VersionItem
  successorVersion: VersionItem | null  // 다음 revision (더 높은 번호)
  isCurrent: boolean
}

function VersionDiffRow({ version, successorVersion, isCurrent }: VersionDiffRowProps) {
  const [expanded, setExpanded] = useState(false)

  // successor 가 있을 때만 diff 표시 (현재 버전 또는 후속 버전 없는 경우 제외)
  const canShowDiff = !!successorVersion

  // diff 요청: base = 현재 버전, compare = successor 버전
  const { data: diffData, isLoading: diffLoading } = useVersionDiff(
    version.project_id,
    successorVersion?.project_id ?? 0,
    expanded && canShowDiff
  )

  const navigate = useNavigate()

  return (
    <li
      className={`text-xs ${isCurrent ? 'bg-accent/50' : 'hover:bg-muted/50'}`}
    >
      {/* 메인 행: 버전 정보 + 펼치기 버튼 */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* 버전 번호 */}
        <span className={`font-semibold shrink-0 ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
          v{version.revision}
        </span>

        {/* 상태 배지 */}
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
            statusBadgeClass[version.status as ProjectStatus] ?? 'bg-gray-100 text-gray-600'
          }`}
        >
          {statusLabel[version.status as ProjectStatus] ?? version.status}
        </span>

        {/* 작성자 + 날짜 + 개정 사유 */}
        <div className="flex-1 min-w-0">
          <div className="truncate text-muted-foreground">
            {version.created_by_name ?? '-'}
          </div>
          <div className="text-[10px] text-muted-foreground/70">
            {formatDate(version.created_at)}
          </div>
          {/* 개정 사유 (있을 경우에만) */}
          {version.revision_reason && (
            <div
              className="text-[10px] text-muted-foreground/80 truncate mt-0.5 italic"
              title={version.revision_reason}
            >
              {version.revision_reason}
            </div>
          )}
        </div>

        {/* 현재 버전 표시 또는 보기 링크 */}
        {isCurrent ? (
          <span className="text-[10px] font-medium text-primary shrink-0">(현재)</span>
        ) : (
          <button
            type="button"
            className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline shrink-0"
            onClick={() => navigate(`/projects/${version.project_id}/edit`)}
          >
            보기
          </button>
        )}

        {/* Diff 펼치기 버튼 - successor 가 있는 경우에만 표시 */}
        {canShowDiff && (
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 p-0.5 rounded hover:bg-muted/80"
            title="변경 내역 보기"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        )}
      </div>

      {/* 펼쳤을 때 - diff 요약 또는 상세 */}
      {expanded && canShowDiff && (
        <div className="border-t border-border bg-muted/20">
          {diffLoading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="ml-1.5 text-[10px] text-muted-foreground">변경 내역 로딩 중...</span>
            </div>
          )}
          {!diffLoading && diffData && (
            <VersionDiffView
              diff={diffData}
            />
          )}
        </div>
      )}
    </li>
  )
}

export function VersionHistoryPanel({ projectId, isOpen, onClose, currentProjectId }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { data: versionData, isLoading } = useVersionHistory(projectId)

  // 외부 클릭 / ESC로 닫기
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e: MouseEvent) {
      // 드롭다운 패널과 그 부모 컨테이너(트리거 버튼 포함) 모두 체크
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

  // revision 내림차순 정렬 (최신 버전이 위)
  const versions = versionData
    ? [...versionData.versions].sort((a, b) => b.revision - a.revision)
    : []

  // revision 오름차순 인덱스 맵: revision -> VersionItem (successor 조회용)
  const versionByRevision = new Map<number, VersionItem>()
  for (const v of versions) {
    versionByRevision.set(v.revision, v)
  }

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-1 z-50 w-80 bg-background border border-border rounded-lg shadow-lg overflow-hidden"
    >
      {/* 헤더 */}
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

      {/* 본문 */}
      <div className="max-h-[480px] overflow-y-auto">
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
              // successor: revision + 1 (더 높은 revision이 이 버전의 후속)
              const successor = versionByRevision.get(v.revision + 1) ?? null
              return (
                <VersionDiffRow
                  key={v.project_id}
                  version={v}
                  successorVersion={successor}
                  isCurrent={isCurrent}
                />
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
