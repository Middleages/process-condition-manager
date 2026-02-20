import { useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, X, ChevronDown, ChevronUp } from 'lucide-react'
import type { ExportValidationResponse, ExportValidationSystemResult } from '@/types/export'

interface ExportValidationReportProps {
  data: ExportValidationResponse
  onClose: () => void
}

interface SystemSectionProps {
  result: ExportValidationSystemResult
}

function SystemSection({ result }: SystemSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const hasIssues = result.issues.length > 0

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="font-medium text-sm text-gray-800">{result.system_name}</span>
          <div className="flex items-center gap-2">
            {result.error_count > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-medium">
                <AlertCircle className="h-3 w-3" />
                오류 {result.error_count}
              </span>
            )}
            {result.warning_count > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-600 text-xs font-medium">
                <AlertTriangle className="h-3 w-3" />
                경고 {result.warning_count}
              </span>
            )}
            {!hasIssues && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-600 text-xs font-medium">
                <CheckCircle className="h-3 w-3" />
                통과
              </span>
            )}
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
        )}
      </button>

      {isExpanded && hasIssues && (
        <div className="divide-y divide-gray-100">
          {/* Errors first */}
          {result.issues
            .filter((issue) => issue.level === 'error')
            .map((issue, idx) => (
              <div
                key={`error-${idx}`}
                className="flex items-start gap-3 px-4 py-3 bg-red-50"
              >
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-red-700">
                      레이어: {issue.layer_name}
                    </span>
                    <span className="text-gray-300">|</span>
                    <span className="text-xs font-medium text-red-700">
                      컬럼: {issue.column_name}
                    </span>
                  </div>
                  <p className="text-xs text-red-600 mt-0.5">{issue.message}</p>
                </div>
              </div>
            ))}

          {/* Warnings after errors */}
          {result.issues
            .filter((issue) => issue.level === 'warning')
            .map((issue, idx) => (
              <div
                key={`warning-${idx}`}
                className="flex items-start gap-3 px-4 py-3 bg-yellow-50"
              >
                <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-yellow-700">
                      레이어: {issue.layer_name}
                    </span>
                    <span className="text-gray-300">|</span>
                    <span className="text-xs font-medium text-yellow-700">
                      컬럼: {issue.column_name}
                    </span>
                  </div>
                  <p className="text-xs text-yellow-600 mt-0.5">{issue.message}</p>
                </div>
              </div>
            ))}
        </div>
      )}

      {isExpanded && !hasIssues && (
        <div className="px-4 py-3 bg-green-50">
          <p className="text-xs text-green-600">이 시스템은 모든 검증을 통과했습니다.</p>
        </div>
      )}
    </div>
  )
}

export function ExportValidationReport({ data, onClose }: ExportValidationReportProps) {
  const allPassed = !data.has_errors && data.total_warnings === 0

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
        <h3 className="text-sm font-semibold text-gray-800">출력 검증 결과</h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 transition-colors"
          aria-label="닫기"
        >
          <X className="h-4 w-4 text-gray-500" />
        </button>
      </div>

      {/* Summary bar */}
      {!allPassed && (
        <div className="flex items-center gap-4 px-4 py-2 border-b bg-gray-50">
          {data.total_errors > 0 && (
            <span className="flex items-center gap-1.5 text-sm text-red-600 font-medium">
              <AlertCircle className="h-4 w-4" />
              오류 {data.total_errors}건
            </span>
          )}
          {data.total_warnings > 0 && (
            <span className="flex items-center gap-1.5 text-sm text-yellow-600 font-medium">
              <AlertTriangle className="h-4 w-4" />
              경고 {data.total_warnings}건
            </span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        {allPassed ? (
          <div className="flex items-center gap-3 px-4 py-6 bg-green-50 rounded-lg justify-center">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <p className="text-sm font-medium text-green-600">모든 검증을 통과했습니다</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.results.map((result) => (
              <SystemSection key={result.system_id} result={result} />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end px-4 py-3 border-t bg-gray-50">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 rounded hover:bg-gray-200 transition-colors"
        >
          닫기
        </button>
      </div>
    </div>
  )
}
