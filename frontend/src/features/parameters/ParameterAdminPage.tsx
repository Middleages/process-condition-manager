import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormEvent, ReactNode, useState } from 'react'

import { createCategory, listCategories } from '@/api/categories'
import {
  applyParameterImport,
  createParameter,
  deactivateParameter,
  listParameters,
  previewParameterImport,
  replaceParameterOptions,
  updateParameter,
} from '@/api/parameters'
import type { ParameterImportResultOut, ParameterOut, ValueType } from '@/api/types'
import { getApiErrorMessage } from '@/api/client'
import { ErrorMessage, LoadingMessage } from '@/shared/components/StatusMessage'

import {
  initialParameterFormState,
  stateFromParameter,
  toCreatePayload,
  toUpdatePayload,
  type ParameterFormState,
} from './form'

const valueTypes: ValueType[] = ['text', 'number', 'choice', 'date', 'boolean']

export function ParameterAdminPage() {
  const queryClient = useQueryClient()
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<ParameterOut | null>(null)
  const [categoryCode, setCategoryCode] = useState('')
  const [categoryDisplayName, setCategoryDisplayName] = useState('')
  const [importCsv, setImportCsv] = useState('')
  const [importPreview, setImportPreview] = useState<ParameterImportResultOut | null>(null)
  const [form, setForm] = useState<ParameterFormState>(initialParameterFormState)

  const parametersQuery = useQuery({
    queryKey: ['parameters', includeInactive],
    queryFn: () => listParameters(includeInactive),
  })
  const categoriesQuery = useQuery({
    queryKey: ['parameter-categories'],
    queryFn: () => listCategories(false),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        const updated = await updateParameter(editing.id, toUpdatePayload(form))
        if (form.valueType === 'choice') {
          return replaceParameterOptions(updated.id, toCreatePayload(form).options ?? [])
        }
        return updated
      }
      return createParameter(toCreatePayload(form))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['parameters'] })
      resetForm()
    },
  })

  const createCategoryMutation = useMutation({
    mutationFn: () =>
      createCategory({
        code: categoryCode.trim(),
        display_name: categoryDisplayName.trim(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['parameter-categories'] })
      setCategoryCode('')
      setCategoryDisplayName('')
    },
  })


  const previewImportMutation = useMutation({
    mutationFn: () => previewParameterImport(importCsv),
    onSuccess: (result) => setImportPreview(result),
  })

  const applyImportMutation = useMutation({
    mutationFn: () => applyParameterImport(importCsv),
    onSuccess: async (result) => {
      setImportPreview(result)
      await queryClient.invalidateQueries({ queryKey: ['parameters'] })
      await queryClient.invalidateQueries({ queryKey: ['parameter-categories'] })
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: deactivateParameter,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['parameters'] })
    },
  })

  function resetForm() {
    setEditing(null)
    setForm(initialParameterFormState)
  }

  function startEdit(parameter: ParameterOut) {
    setEditing(parameter)
    setForm(stateFromParameter(parameter))
  }

  function updateField<K extends keyof ParameterFormState>(key: K, value: ParameterFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    saveMutation.mutate()
  }

  function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createCategoryMutation.mutate()
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm text-cyan-700">Phase 0 · EC1/EC3 확인</p>
        <h2 className="text-2xl font-semibold">파라미터 관리</h2>
        <p className="mt-2 text-sm text-slate-500">
          파라미터를 추가·수정·비활성화하고 목록 반영을 즉시 확인한다.
        </p>
      </div>


      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">CSV 파라미터 일괄 임포트</h3>
          <p className="mt-1 text-sm text-slate-500">
            첫 줄은 헤더다. 줄바꿈이 들어간 헤더는 제거해서 매핑하고, choice 옵션은 CSV 셀 안에서 콤마로 구분한다.
          </p>
        </div>
        <textarea
          className="input min-h-36 font-mono text-sm"
          value={importCsv}
          onChange={(event) => setImportCsv(event.target.value)}
          placeholder={'code,display name,value_type,category,choices\nmode,Mode,choice,photo,"A,B"'}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="btn-secondary"
            type="button"
            disabled={previewImportMutation.isPending || importCsv.trim() === ''}
            onClick={() => previewImportMutation.mutate()}
          >
            미리보기
          </button>
          <button
            className="btn-primary"
            type="button"
            disabled={applyImportMutation.isPending || importCsv.trim() === ''}
            onClick={() => applyImportMutation.mutate()}
          >
            적용
          </button>
          {previewImportMutation.isError ? <span className="text-sm text-red-600">{getApiErrorMessage(previewImportMutation.error)}</span> : null}
          {applyImportMutation.isError ? <span className="text-sm text-red-600">{getApiErrorMessage(applyImportMutation.error)}</span> : null}
        </div>
        {importPreview ? <ImportResult result={importPreview} /> : null}
      </section>

      <form onSubmit={submitCategory} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <h3 className="mb-4 text-lg font-semibold">카테고리 추가</h3>
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <Field label="Category code">
            <input
              className="input"
              value={categoryCode}
              onChange={(event) => setCategoryCode(event.target.value)}
              required
            />
          </Field>
          <Field label="표시명">
            <input
              className="input"
              value={categoryDisplayName}
              onChange={(event) => setCategoryDisplayName(event.target.value)}
              required
            />
          </Field>
          <div className="flex items-end">
            <button className="btn-secondary" type="submit" disabled={createCategoryMutation.isPending}>
              카테고리 저장
            </button>
          </div>
        </div>
        {createCategoryMutation.isError ? (
          <p className="mt-3 text-sm text-red-600">{getApiErrorMessage(createCategoryMutation.error)}</p>
        ) : null}
      </form>

      <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">{editing ? '파라미터 수정' : '파라미터 추가'}</h3>
          {editing ? (
            <button type="button" className="text-sm text-slate-600 underline" onClick={resetForm}>
              새 파라미터 입력
            </button>
          ) : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Code">
            <input
              className="input"
              value={form.code}
              onChange={(event) => updateField('code', event.target.value)}
              disabled={editing !== null}
              required
            />
          </Field>
          <Field label="표시명">
            <input
              className="input"
              value={form.displayName}
              onChange={(event) => updateField('displayName', event.target.value)}
              required
            />
          </Field>
          <Field label="타입">
            <select
              className="input"
              value={form.valueType}
              onChange={(event) => updateField('valueType', event.target.value as ValueType)}
              disabled={editing !== null}
            >
              {valueTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="카테고리">
            <select
              className="input"
              value={form.categoryId}
              onChange={(event) => updateField('categoryId', event.target.value)}
            >
              <option value="">없음</option>
              {(categoriesQuery.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="단위">
            <input
              className="input"
              value={form.unit}
              onChange={(event) => updateField('unit', event.target.value)}
            />
          </Field>
          <Field label="최소값">
            <input
              className="input"
              type="number"
              value={form.minValue}
              onChange={(event) => updateField('minValue', event.target.value)}
            />
          </Field>
          <Field label="최대값">
            <input
              className="input"
              type="number"
              value={form.maxValue}
              onChange={(event) => updateField('maxValue', event.target.value)}
            />
          </Field>
          <Field label="설명">
            <input
              className="input"
              value={form.description}
              onChange={(event) => updateField('description', event.target.value)}
            />
          </Field>
          <Field label="선택지(choice, 쉼표 구분)">
            <input
              className="input"
              value={form.optionsText}
              onChange={(event) => updateField('optionsText', event.target.value)}
              disabled={form.valueType !== 'choice' || editing !== null}
              placeholder="pos, neg"
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn-primary" type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? '저장 중...' : '저장'}
          </button>
          {saveMutation.isError ? <span className="text-sm text-red-600">{getApiErrorMessage(saveMutation.error)}</span> : null}
        </div>
      </form>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">파라미터 목록</h3>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
          />
          비활성 포함
        </label>
      </div>

      {parametersQuery.isLoading ? <LoadingMessage /> : null}
      {parametersQuery.isError ? <ErrorMessage message={getApiErrorMessage(parametersQuery.error)} /> : null}
      {parametersQuery.data ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3">code</th>
                <th className="px-4 py-3">표시명</th>
                <th className="px-4 py-3">타입</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">작업</th>
              </tr>
            </thead>
            <tbody>
              {parametersQuery.data.map((parameter) => (
                <tr key={parameter.id} className="border-t border-slate-200">
                  <td className="px-4 py-3 font-mono text-cyan-700">{parameter.code}</td>
                  <td className="px-4 py-3">{parameter.display_name}</td>
                  <td className="px-4 py-3">{parameter.value_type}</td>
                  <td className="px-4 py-3">{parameter.is_active ? 'active' : 'inactive'}</td>
                  <td className="space-x-2 px-4 py-3">
                    <button className="btn-secondary" type="button" onClick={() => startEdit(parameter)}>
                      수정
                    </button>
                    <button
                      className="btn-danger"
                      type="button"
                      disabled={!parameter.is_active || deactivateMutation.isPending}
                      onClick={() => deactivateMutation.mutate(parameter.id)}
                    >
                      비활성화
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {parametersQuery.data.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">등록된 파라미터가 없다.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm text-slate-600">
      <span>{label}</span>
      {children}
    </label>
  )
}


function ImportResult({ result }: { result: ParameterImportResultOut }) {
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">신규 {result.new_count}</span>
        <span className="rounded-full bg-cyan-50 px-2 py-1 text-cyan-700">갱신 {result.update_count}</span>
        <span className="rounded-full bg-red-50 px-2 py-1 text-red-700">오류 {result.error_count}</span>
      </div>
      {result.errors.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-red-700">
          {result.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      {result.rows.length > 0 ? (
        <ul className="mt-3 grid gap-1 text-slate-600 md:grid-cols-2">
          {result.rows.slice(0, 8).map((row) => (
            <li key={`${row.row_number}-${row.code}`} className="font-mono">
              {row.row_number}행 · {row.code} · {row.action}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
