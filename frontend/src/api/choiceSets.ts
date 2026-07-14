import type { AxiosRequestConfig } from 'axios'

import { apiClient, getChoiceSetChangedDetails, isChoiceSetChanged } from './client'
import type {
  ChoiceImportApplyOut,
  ChoiceImportIn,
  ChoiceImportPreviewOut,
  ChoiceOptionAggregate,
  ChoiceOptionCreateIn,
  ChoiceOptionMutationOut,
  ChoiceOptionOrderIn,
  ChoiceOptionPageOut,
  ChoiceOptionPatchIn,
  ChoiceSetCreateIn,
  ChoiceSetPatchIn,
  ChoiceSetSummaryOut,
} from './types'

const CHOICE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MAX_VERSION_RESTARTS = 2
const OPTION_PAGE_LIMIT = 500

export interface ListChoiceOptionsParams {
  q?: string
  version?: number
  cursor?: string
  limit?: number
  include_inactive?: boolean
}

export async function listChoiceSets(includeInactive = false): Promise<ChoiceSetSummaryOut[]> {
  const response = await apiClient.get<ChoiceSetSummaryOut[]>('/choice-sets', {
    params: { include_inactive: includeInactive },
  })
  return response.data
}

export async function createChoiceSet(payload: ChoiceSetCreateIn): Promise<ChoiceSetSummaryOut> {
  const response = await apiClient.post<ChoiceSetSummaryOut>('/choice-sets', payload)
  return response.data
}

export async function getChoiceSet(setCode: string): Promise<ChoiceSetSummaryOut> {
  const response = await apiClient.get<ChoiceSetSummaryOut>(choiceSetPath(setCode))
  return response.data
}

export async function patchChoiceSet(
  setCode: string,
  payload: ChoiceSetPatchIn,
): Promise<ChoiceSetSummaryOut> {
  const response = await apiClient.patch<ChoiceSetSummaryOut>(choiceSetPath(setCode), payload)
  return response.data
}

export async function listChoiceOptions(
  setCode: string,
  params: ListChoiceOptionsParams = {},
): Promise<ChoiceOptionPageOut> {
  return requestChoiceOptionPage(setCode, params)
}

export async function createChoiceOption(
  setCode: string,
  payload: ChoiceOptionCreateIn,
): Promise<ChoiceOptionMutationOut> {
  const response = await apiClient.post<ChoiceOptionMutationOut>(
    `${choiceSetPath(setCode)}/options`,
    payload,
  )
  return response.data
}

export async function patchChoiceOption(
  setCode: string,
  optionCode: string,
  payload: ChoiceOptionPatchIn,
): Promise<ChoiceOptionMutationOut> {
  const response = await apiClient.patch<ChoiceOptionMutationOut>(
    `${choiceSetPath(setCode)}/options/${safePathSegment(optionCode, 128, 'Choice option')}`,
    payload,
  )
  return response.data
}

export async function reorderChoiceOptions(
  setCode: string,
  payload: ChoiceOptionOrderIn,
): Promise<ChoiceSetSummaryOut> {
  const response = await apiClient.put<ChoiceSetSummaryOut>(
    `${choiceSetPath(setCode)}/option-order`,
    payload,
  )
  return response.data
}

export async function previewChoiceImport(
  setCode: string,
  payload: ChoiceImportIn,
): Promise<ChoiceImportPreviewOut> {
  const response = await apiClient.post<ChoiceImportPreviewOut>(
    `${choiceSetPath(setCode)}/import/preview`,
    payload,
  )
  return response.data
}

export async function applyChoiceImport(
  setCode: string,
  payload: ChoiceImportIn,
): Promise<ChoiceImportApplyOut> {
  const response = await apiClient.post<ChoiceImportApplyOut>(
    `${choiceSetPath(setCode)}/import`,
    payload,
  )
  return response.data
}

export async function fetchAllChoiceOptions(
  setCode: string,
  knownVersion: number | undefined,
  includeInactive: boolean,
  signal?: AbortSignal,
): Promise<ChoiceOptionAggregate> {
  let requestedVersion = knownVersion
  let restartCount = 0

  aggregateAttempt: while (true) {
    const items: ChoiceOptionAggregate['items'] = []
    const seenCodes = new Set<string>()
    let aggregateVersion: number | undefined
    let cursor: string | undefined

    while (true) {
      throwIfAborted(signal)
      let page: ChoiceOptionPageOut
      try {
        page = await requestChoiceOptionPage(
          setCode,
          {
            version: aggregateVersion ?? requestedVersion,
            cursor,
            limit: OPTION_PAGE_LIMIT,
            include_inactive: includeInactive,
          },
          signal,
        )
      } catch (error) {
        throwIfAborted(signal)
        const actualVersion = getActualChoiceSetVersion(error)
        if (actualVersion !== null && restartCount < MAX_VERSION_RESTARTS) {
          restartCount += 1
          requestedVersion = actualVersion
          continue aggregateAttempt
        }
        throw error
      }
      throwIfAborted(signal)
      assertChoiceOptionPage(page, setCode)

      if (aggregateVersion === undefined) {
        if (requestedVersion !== undefined && page.version !== requestedVersion) {
          if (restartCount >= MAX_VERSION_RESTARTS) {
            throw malformedPage(
              `first page version ${page.version} did not match requested version ${requestedVersion}`,
            )
          }
          restartCount += 1
          requestedVersion = page.version
          continue aggregateAttempt
        }
        aggregateVersion = page.version
      } else if (page.version !== aggregateVersion) {
        throw malformedPage(
          `page version ${page.version} did not match aggregate version ${aggregateVersion}`,
        )
      }

      for (const item of page.items) {
        if (seenCodes.has(item.code)) {
          throw malformedPage(`duplicate choice option code: ${item.code}`)
        }
        seenCodes.add(item.code)
        items.push(item)
      }

      if (page.next_cursor === null) {
        return { set_code: setCode, version: aggregateVersion, items }
      }
      cursor = page.next_cursor
    }
  }
}

async function requestChoiceOptionPage(
  setCode: string,
  params: ListChoiceOptionsParams,
  signal?: AbortSignal,
): Promise<ChoiceOptionPageOut> {
  const config: AxiosRequestConfig = { params }
  if (signal !== undefined) config.signal = signal
  const response = await apiClient.get<ChoiceOptionPageOut>(
    `${choiceSetPath(setCode)}/options`,
    config,
  )
  return response.data
}

function choiceSetPath(setCode: string): string {
  return `/choice-sets/${safePathSegment(setCode, 64, 'Choice set')}`
}

function safePathSegment(code: string, maxLength: number, label: string): string {
  if (
    code.length === 0 ||
    code.length > maxLength ||
    code === '.' ||
    code === '..' ||
    !CHOICE_CODE_PATTERN.test(code)
  ) {
    throw new TypeError(`${label} code must be a URL-safe ASCII identity`)
  }
  return encodeURIComponent(code)
}

function getActualChoiceSetVersion(error: unknown): number | null {
  if (!isChoiceSetChanged(error)) return null
  const actualVersion = getChoiceSetChangedDetails(error)?.actual_version
  return Number.isInteger(actualVersion) && (actualVersion as number) > 0
    ? (actualVersion as number)
    : null
}

function assertChoiceOptionPage(
  page: unknown,
  requestedSetCode: string,
): asserts page is ChoiceOptionPageOut {
  if (page === null || typeof page !== 'object' || Array.isArray(page)) {
    throw malformedPage('response was not an object')
  }
  const candidate = page as Record<string, unknown>
  const hasValidItems =
    Array.isArray(candidate.items) &&
    candidate.items.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof item.code === 'string' &&
        typeof item.label === 'string' &&
        Number.isInteger(item.sort_order) &&
        typeof item.is_active === 'boolean',
    )
  if (
    candidate.set_code !== requestedSetCode ||
    !Number.isInteger(candidate.version) ||
    (candidate.version as number) < 1 ||
    !hasValidItems ||
    (candidate.next_cursor !== null && typeof candidate.next_cursor !== 'string')
  ) {
    throw malformedPage('set, version, item, or cursor contract did not match')
  }
}

function malformedPage(reason: string): Error {
  return new Error(`Malformed choice option page: ${reason}`)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  signal.throwIfAborted()
  throw new DOMException('The operation was aborted', 'AbortError')
}
