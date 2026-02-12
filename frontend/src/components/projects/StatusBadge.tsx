import { Badge } from '@/components/ui/badge'
import type { ProjectStatus } from '@/types'

const statusLabel: Record<ProjectStatus, string> = {
  draft: 'Draft',
  review: 'Review',
  approved: 'Approved',
  rejected: 'Rejected',
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge variant={status}>{statusLabel[status]}</Badge>
}
