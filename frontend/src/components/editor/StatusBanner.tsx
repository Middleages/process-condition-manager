import type { ProjectStatus } from '@/types'
import { Info, AlertTriangle, CheckCircle2, XCircle, Archive } from 'lucide-react'

const statusConfig: Record<ProjectStatus, {
  bg: string
  text: string
  border: string
  icon: React.ElementType
  message: string
}> = {
  draft: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    icon: Info,
    message: '조건표를 편집할 수 있습니다. 검토 요청 전에 저장해주세요.',
  },
  review: {
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-200',
    icon: AlertTriangle,
    message: '검토 중입니다. 편집이 비활성화되었습니다.',
  },
  approved: {
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
    icon: CheckCircle2,
    message: '승인 완료. 이 조건표는 확정되었습니다.',
  },
  rejected: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    icon: XCircle,
    message: '반려되었습니다. 댓글을 확인하고 수정해주세요.',
  },
  archived: {
    bg: 'bg-gray-50',
    text: 'text-gray-600',
    border: 'border-gray-200',
    icon: Archive,
    message: '보관됨. 이전 버전입니다.',
  },
}

interface Props {
  status: ProjectStatus
  revision?: number
  onBackToCurrent?: () => void
}

export function StatusBanner({ status, revision, onBackToCurrent }: Props) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <div className={`flex items-center gap-2 px-4 py-2 border-b ${config.bg} ${config.border} ${config.text} text-sm shrink-0`}>
      <Icon className="h-4 w-4 shrink-0" />
      <span>
        {status === 'archived' && revision
          ? `보관됨 (v${revision}). 이전 버전입니다.`
          : config.message}
      </span>
      {status === 'archived' && onBackToCurrent && (
        <>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onBackToCurrent}
            className="px-3 py-1 text-xs font-medium bg-white/80 hover:bg-white border border-gray-300 rounded"
          >
            최신 버전으로 이동
          </button>
        </>
      )}
    </div>
  )
}
