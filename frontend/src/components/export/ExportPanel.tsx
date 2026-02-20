import { useState } from 'react'
import { Printer, ChevronDown, ChevronUp, Loader2, Download } from 'lucide-react'
import { useExportSystems } from '@/hooks/useExportSystems'
import { useExportPreview } from '@/hooks/useExportPreview'
import { validateExport, downloadExport } from '@/api/export'
import { ExportSystemList } from './ExportSystemList'
import { ExportPreviewTable } from './ExportPreviewTable'
import { ExportDownloadButton } from './ExportDownloadButton'
import { ExportHistoryPanel } from './ExportHistoryPanel'
import { ExportValidationReport } from './ExportValidationReport'
import type { ExportValidationResponse } from '@/types/export'

interface ExportPanelProps {
  projectId: number
}

export function ExportPanel({ projectId }: ExportPanelProps) {
  // 패널 펼침 상태
  const [isExpanded, setIsExpanded] = useState(false)

  // 체크된 시스템 ID 목록
  const [selectedSystemIds, setSelectedSystemIds] = useState<number[]>([])

  // 미리보기 중인 시스템 ID
  const [previewSystemId, setPreviewSystemId] = useState<number | null>(null)

  // 다운로드 중인 단건 시스템 ID
  const [downloadingId, setDownloadingId] = useState<number | null>(null)

  // 벌크 다운로드 중 여부
  const [isBulkDownloading, setIsBulkDownloading] = useState(false)

  // 검증 결과
  const [validationResult, setValidationResult] = useState<ExportValidationResponse | null>(null)

  // 검증 진행 중
  const [isValidating, setIsValidating] = useState(false)

  // 전산 출력 시스템 목록 조회
  const { data: systems = [], isLoading: systemsLoading } = useExportSystems()

  // 미리보기 데이터 조회
  const {
    data: preview = null,
    isFetching: previewLoading,
  } = useExportPreview(projectId, previewSystemId)

  // 체크박스 토글
  const handleToggle = (systemId: number) => {
    setSelectedSystemIds((prev) =>
      prev.includes(systemId)
        ? prev.filter((id) => id !== systemId)
        : [...prev, systemId]
    )
  }

  // 미리보기 버튼 클릭
  const handlePreview = (systemId: number) => {
    setPreviewSystemId((prev) => (prev === systemId ? null : systemId))
  }

  // 브라우저 다운로드 트리거
  const triggerDownload = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }

  // 단건 다운로드 처리
  const handleDownloadSingle = async (systemId: number) => {
    setDownloadingId(systemId)
    try {
      const { blob, filename } = await downloadExport(projectId, [systemId])
      triggerDownload(blob, filename)
    } catch {
      // Axios 인터셉터에서 에러 처리
    } finally {
      setDownloadingId(null)
    }
  }

  // 벌크 다운로드 처리 (검증 선행)
  const handleBulkDownload = async () => {
    if (selectedSystemIds.length === 0) return

    // Step 1: Validate
    setIsValidating(true)
    try {
      const result = await validateExport(projectId, selectedSystemIds)
      setValidationResult(result)

      // Step 2: If errors exist, stop here (show report only)
      if (result.has_errors) {
        setIsValidating(false)
        return
      }

      // Step 3: No errors -> proceed to download
      setIsValidating(false)
      setIsBulkDownloading(true)
      const { blob, filename } = await downloadExport(projectId, selectedSystemIds)
      triggerDownload(blob, filename)
    } catch {
      // Axios 인터셉터에서 에러 처리
    } finally {
      setIsValidating(false)
      setIsBulkDownloading(false)
    }
  }

  // 경고 무시하고 다운로드 진행
  const handleProceedDownload = async () => {
    setValidationResult(null)
    setIsBulkDownloading(true)
    try {
      const { blob, filename } = await downloadExport(projectId, selectedSystemIds)
      triggerDownload(blob, filename)
    } catch {
      // Axios 인터셉터에서 에러 처리
    } finally {
      setIsBulkDownloading(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg mx-4 mb-2 bg-white shadow-sm shrink-0">
      {/* 패널 헤더 */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <Printer className="h-4 w-4 text-gray-500 shrink-0" />
        <span className="text-sm font-medium text-gray-800 flex-1">전산 출력</span>
        {selectedSystemIds.length > 0 && !isExpanded && (
          <span className="text-xs text-primary font-medium">
            {selectedSystemIds.length}개 선택
          </span>
        )}
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>

      {/* 패널 본문 */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          {/* 시스템 목록 */}
          <div className="mt-3">
            {systemsLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  출력 시스템 불러오는 중...
                </span>
              </div>
            ) : (
              <ExportSystemList
                systems={systems}
                selectedIds={selectedSystemIds}
                onToggle={handleToggle}
                onPreview={handlePreview}
                onDownloadSingle={handleDownloadSingle}
                downloadingId={downloadingId}
              />
            )}
          </div>

          {/* 미리보기 테이블 */}
          {previewSystemId && (
            <ExportPreviewTable preview={preview} isLoading={previewLoading} />
          )}

          {/* 검증 결과 */}
          {validationResult && (
            <div className="mt-4">
              <ExportValidationReport
                data={validationResult}
                onClose={() => setValidationResult(null)}
              />
              {/* 경고만 있을 때 다운로드 진행 버튼 */}
              {!validationResult.has_errors && validationResult.total_warnings > 0 && (
                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    onClick={handleProceedDownload}
                    disabled={isBulkDownloading}
                    className="flex items-center gap-2 px-4 py-2 rounded text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm transition-colors disabled:opacity-50"
                  >
                    {isBulkDownloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    경고 무시하고 다운로드
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 하단: 벌크 다운로드 버튼 */}
          <div className="flex justify-end mt-4">
            <ExportDownloadButton
              selectedCount={selectedSystemIds.length}
              isDownloading={isBulkDownloading || isValidating}
              onClick={handleBulkDownload}
            />
          </div>

          {/* 출력 이력 */}
          <ExportHistoryPanel projectId={projectId} />
        </div>
      )}
    </div>
  )
}
