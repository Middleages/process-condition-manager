import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { getApiErrorMessage } from '@/api/client'
import { applyParameterImport, previewParameterImport } from '@/api/parameters'
import type { ImportResultOut } from '@/api/types'

const SAMPLE = 'code,display_name,type,category,min,max,options\nspin_speed,Spin Speed,number,sp,0,5000,\npr_type,PR Type,choice,sp,,,"pos,neg"'

export function CsvImportPanel() {
  const queryClient = useQueryClient()
  const [csvText, setCsvText] = useState('')
  const [preview, setPreview] = useState<ImportResultOut | null>(null)

  const previewMutation = useMutation({
    mutationFn: () => previewParameterImport(csvText),
    onSuccess: setPreview,
  })

  const applyMutation = useMutation({
    mutationFn: () => applyParameterImport(csvText),
    onSuccess: async (result) => {
      setPreview(result)
      await queryClient.invalidateQueries({ queryKey: ['parameters'] })
      await queryClient.invalidateQueries({ queryKey: ['parameter-categories'] })
    },
  })

  const hasErrors = (preview?.error_count ?? 0) > 0
  const canApply = preview !== null && (preview.created_count + preview.updated_count) > 0

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">CSV 붙여넣기 임포트 (D-17)</h3>
        <p className="mt-1 text-sm text-slate-500">
          약 200개 파라미터를 한 번에 등록/갱신한다. code 기준 UPSERT — 미리보기로 신규/갱신/오류를
          확인한 뒤 적용한다. 첫 행은 헤더(code 필수).
        </p>
      </div>

      <textarea
        className="input h-40 w-full font-mono text-xs"
        value={csvText}
        onChange={(event) => {
          setCsvText(event.target.value)
          setPreview(null)
        }}
        placeholder={SAMPLE}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          className="btn-secondary"
          type="button"
          disabled={csvText.trim() === '' || previewMutation.isPending}
          onClick={() => previewMutation.mutate()}
        >
          {previewMutation.isPending ? '미리보기 중...' : '미리보기 (dry-run)'}
        </button>
        <button
          className="btn-primary"
          type="button"
          disabled={!canApply || applyMutation.isPending}
          onClick={() => applyMutation.mutate()}
        >
          {applyMutation.isPending ? '적용 중...' : '적용'}
        </button>
        {hasErrors ? (
          <span className="text-sm text-amber-600">오류 행은 적용되지 않는다.</span>
        ) : null}
      </div>

      {previewMutation.isError ? (
        <p className="mt-3 text-sm text-red-600">{getApiErrorMessage(previewMutation.error)}</p>
      ) : null}
      {applyMutation.isError ? (
        <p className="mt-3 text-sm text-red-600">{getApiErrorMessage(applyMutation.error)}</p>
      ) : null}

      {preview ? <ImportSummary result={preview} applied={applyMutation.isSuccess} /> : null}
    </section>
  )
}

function ImportSummary({ result, applied }: { result: ImportResultOut; applied: boolean }) {
  const errorRows = result.rows.filter((row) => row.action === 'error')
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="green" label={`${applied ? '생성됨' : '신규'} ${result.created_count}`} />
        <Badge tone="cyan" label={`${applied ? '갱신됨' : '갱신'} ${result.updated_count}`} />
        <Badge tone={result.error_count > 0 ? 'red' : 'slate'} label={`오류 ${result.error_count}`} />
      </div>
      {errorRows.length > 0 ? (
        <ul className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorRows.map((row) => (
            <li key={`${row.line}-${row.code}`}>
              {row.line}행 <span className="font-mono">{row.code || '(code 없음)'}</span> — {row.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

const TONE: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700',
  cyan: 'bg-cyan-50 text-cyan-700',
  red: 'bg-red-50 text-red-700',
  slate: 'bg-slate-100 text-slate-600',
}

function Badge({ tone, label }: { tone: keyof typeof TONE | string; label: string }) {
  return (
    <span className={`rounded-full px-3 py-1 font-medium ${TONE[tone] ?? TONE.slate}`}>{label}</span>
  )
}
