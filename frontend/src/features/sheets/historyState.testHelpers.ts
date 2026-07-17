import type { HistoryTimelineItemOut } from '@/api/history'

export function createHistoryTimelineItem(cursorId: number): HistoryTimelineItemOut {
  return {
    kind: 'event',
    cursor_id: cursorId,
    event_types: ['cell_update'],
    actors: ['dev-admin'],
    origins: ['manual'],
    started_at: '2026-07-17T00:00:00Z',
    occurred_at: '2026-07-17T00:00:00Z',
    layer_keys: ['L1::10::ETCH'],
    source_project_id: null,
    batch_id: `batch-${cursorId}`,
    matched_event_count: 1,
    total_event_count: 1,
    summary: `event-${cursorId}`,
    jump_target: null,
    detail_status: 'available',
    detail_scope: null,
    metadata_status: 'complete',
  }
}
