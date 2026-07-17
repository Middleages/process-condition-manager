import axios, { type AxiosError } from 'axios'

import { apiClient } from './client'
import type { ApiErrorBody } from './types'
import {
  backboneDiffBranchPath,
  backboneDiffCellPath,
  buildBackboneDiffBranchQueryString,
  buildBackboneDiffCellQueryString,
  buildBackboneDiffRootQueryString,
} from './backboneDiffQuery'
export type {
  BackboneDiffCellItemOut,
  BackboneDiffCellPageOut,
  BackboneDiffCellQueryInput,
  BackboneDiffCellQueryOptions,
  BackboneDiffConditionItemOut,
  BackboneDiffConditionMetadataOut,
  BackboneDiffConditionPageOut,
  BackboneDiffParameterMetadataOut,
  BackboneDiffCountsOut,
  BackboneDiffLayerSummaryOut,
  BackboneDiffPreviewItemOut,
  BackboneDiffRowMetadataOut,
  BackboneDiffRootOut,
  BackboneDiffRootQueryInput,
  BackboneDiffRootQueryOptions,
  BackboneDiffBranchQueryInput,
  BackboneDiffBranchQueryOptions,
} from './backboneDiffQuery'
import type { BackboneDiffRootOut, BackboneDiffRootQueryInput, BackboneDiffBranchQueryInput, BackboneDiffConditionPageOut, BackboneDiffCellQueryInput, BackboneDiffCellPageOut } from './backboneDiffQuery'

export async function getBackboneDiffRoot(
  projectId: number,
  query: BackboneDiffRootQueryInput = {},
): Promise<BackboneDiffRootOut> {
  const response = await apiClient.get<BackboneDiffRootOut>(
    `/projects/${projectId}/backbone-diff?${buildBackboneDiffRootQueryString(query)}`,
  )
  return response.data
}

export async function getBackboneDiffConditions(
  projectId: number,
  layerKey: string,
  query: BackboneDiffBranchQueryInput,
): Promise<BackboneDiffConditionPageOut> {
  const response = await apiClient.get<BackboneDiffConditionPageOut>(
    `${backboneDiffBranchPath(projectId, layerKey)}?${buildBackboneDiffBranchQueryString(query)}`,
  )
  return response.data
}

export async function getBackboneDiffCells(
  projectId: number,
  layerKey: string,
  rowRef: string,
  query: BackboneDiffCellQueryInput,
): Promise<BackboneDiffCellPageOut> {
  const response = await apiClient.get<BackboneDiffCellPageOut>(
    `${backboneDiffCellPath(projectId, layerKey, rowRef)}?${buildBackboneDiffCellQueryString(query)}`,
  )
  return response.data
}

export function isDiffBasisChanged(error: unknown): boolean {
  return isApiError(error) && error.response?.status === 409 && error.response.data.code === 'diff_basis_changed'
}

function isApiError(
  error: unknown,
): error is AxiosError<ApiErrorBody & Record<string, unknown>> {
  return axios.isAxiosError<ApiErrorBody & Record<string, unknown>>(error)
}
