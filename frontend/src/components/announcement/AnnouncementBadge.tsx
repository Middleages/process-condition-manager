import type { AnnouncementCategory, AnnouncementPriority } from '@/types'

// 카테고리 한국어 레이블
const CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  bug_fix: '버그 수정',
  new_feature: '신규 기능',
  rule_change: '규칙 변경',
  general: '일반',
}

// 카테고리 색상 스타일
const CATEGORY_STYLES: Record<AnnouncementCategory, string> = {
  bug_fix: 'bg-red-100 text-red-700',
  new_feature: 'bg-blue-100 text-blue-700',
  rule_change: 'bg-orange-100 text-orange-700',
  general: 'bg-gray-100 text-gray-700',
}

// 우선순위 한국어 레이블
const PRIORITY_LABELS: Record<AnnouncementPriority, string> = {
  normal: '일반',
  important: '중요',
  critical: '긴급',
}

// 우선순위 색상 스타일
const PRIORITY_STYLES: Record<AnnouncementPriority, string> = {
  normal: '',
  important: 'bg-yellow-100 text-yellow-700',
  critical: 'bg-red-100 text-red-800 font-bold',
}

interface CategoryBadgeProps {
  category: AnnouncementCategory
}

export function CategoryBadge({ category }: CategoryBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_STYLES[category]}`}
    >
      {CATEGORY_LABELS[category]}
    </span>
  )
}

interface PriorityBadgeProps {
  priority: AnnouncementPriority
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  // normal 우선순위는 렌더링하지 않음
  if (priority === 'normal') return null

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_STYLES[priority]}`}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  )
}
