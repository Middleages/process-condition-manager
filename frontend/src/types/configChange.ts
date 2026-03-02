// 설정 변경 요청 유형
export type ConfigChangeType = 'column_add' | 'column_modify' | 'validation_change'

// 설정 변경 요청 상태
export type ConfigChangeStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

// 투표 결과
export type VoteResult = 'approve' | 'reject'

// 투표 요약
export interface VoteSummary {
  total: number
  approved: number
  rejected: number
  pending: number
}

// 설정 변경 요청 (목록용)
export interface ConfigChangeResponse {
  id: number
  title: string
  description: string
  change_type: ConfigChangeType
  status: ConfigChangeStatus
  requested_by: number
  requester_name: string | null
  implemented_by: number | null
  implementer_name: string | null
  created_at: string
  updated_at: string
  approved_at: string | null
  completed_at: string | null
  vote_summary: VoteSummary | null
}

// 개별 투표
export interface ConfigChangeVoteResponse {
  id: number
  line_id: number
  line_name: string | null
  line_code: string | null
  vote: VoteResult | null
  voted_by: number | null
  voter_name: string | null
  reason: string | null
  voted_at: string | null
}

// 설정 변경 요청 상세 (투표 포함)
export interface ConfigChangeDetailResponse extends ConfigChangeResponse {
  votes: ConfigChangeVoteResponse[]
}

// 목록 응답
export interface ConfigChangeListResponse {
  items: ConfigChangeResponse[]
  total: number
}

// 생성 요청
export interface ConfigChangeCreateRequest {
  title: string
  description: string
  change_type: ConfigChangeType
}

// 투표 요청
export interface ConfigChangeVoteRequest {
  vote: VoteResult
  reason?: string | null
}
