import type { ProjectListRouteState } from './urlState'

export function projectListQueryKey(routeState: ProjectListRouteState) {
  return [
    'projects',
    'list',
    {
      query: routeState.query,
      status: routeState.status,
      deviceTypeCode: routeState.deviceTypeCode,
      projectCategoryCode: routeState.projectCategoryCode,
    },
  ] as const
}

export function mergeDebouncedQuery(
  latestRouteState: ProjectListRouteState,
  debouncedQuery: string,
): ProjectListRouteState {
  return { ...latestRouteState, query: debouncedQuery }
}

export function deriveHistoricalChoiceFilterState(resource: {
  version: number | null
  setIsActive: boolean | null
  loading: boolean
  refreshing: boolean
  error: string | null
}): { loading: boolean; selectionReady: boolean } {
  const loading = resource.loading || resource.refreshing
  return {
    loading,
    selectionReady: !loading && resource.error === null && resource.version !== null,
  }
}
