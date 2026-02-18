// 전산 출력 시스템 타입 정의

export interface ExportSystem {
  id: number
  system_name: string
  format_type: 'TYPE_A' | 'TYPE_B' | 'TYPE_C'
  description: string | null
  column_count: number
  is_active: boolean
}

export interface ExportPreview {
  system_name: string
  format_type: string
  headers: string[]
  rows: Record<string, unknown>[]
  total_rows: number
}
