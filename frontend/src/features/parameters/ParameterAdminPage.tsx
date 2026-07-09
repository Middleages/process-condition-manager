import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormEvent, ReactNode, useState } from 'react'

import { createCategory, listCategories } from '@/api/categories'
import {
  createParameter,
  deactivateParameter,
  listParameters,
  replaceParameterOptions,
  updateParameter,
} from '@/api/parameters'
import type { ParameterOut, ValueType } from '@/api/types'
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
