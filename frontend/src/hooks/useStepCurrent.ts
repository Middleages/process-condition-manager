import { useQuery } from '@tanstack/react-query'
import { fetchStepCurrentLayers, fetchStepCurrentPartOptions, fetchStepCurrentProcessOptions } from '@/api/deviceMaster'

export const stepCurrentKeys = {
  all: ['step-current'] as const,
  processes: (lineId: number) => [...stepCurrentKeys.all, 'processes', lineId] as const,
  parts: (params: { line_id: number; process_id: string }) =>
    [...stepCurrentKeys.all, 'parts', params] as const,
  layers: (params: { line_id: number; process_id: string; part_id: string }) =>
    [...stepCurrentKeys.all, 'layers', params] as const,
}

export function useStepCurrentProcesses(lineId?: number) {
  return useQuery({
    queryKey: stepCurrentKeys.processes(lineId ?? 0),
    queryFn: () => fetchStepCurrentProcessOptions(lineId!),
    enabled: typeof lineId === 'number' && lineId > 0,
  })
}



export function useStepCurrentParts(params: {
  line_id?: number
  process_id?: string
  part_id?: string
}) {
  const lineId = params.line_id
  const processId = params.process_id?.trim() ?? ''

  return useQuery({
    queryKey: stepCurrentKeys.parts({ line_id: lineId ?? 0, process_id: processId }),
    queryFn: () => fetchStepCurrentPartOptions(lineId!, processId),
    enabled: typeof lineId === 'number' && lineId > 0 && processId.length > 0,
  })
}

export function useStepCurrentLayers(params: {
  line_id?: number
  process_id?: string
  part_id?: string
}) {
  const lineId = params.line_id
  const processId = params.process_id?.trim() ?? ''
  const partId = params.part_id?.trim() ?? ''

  return useQuery({
    queryKey: stepCurrentKeys.layers({ line_id: lineId ?? 0, process_id: processId, part_id: partId }),
    queryFn: () =>
      fetchStepCurrentLayers({
        line_id: lineId!,
        process_id: processId,
        part_id: partId,
      }),
    enabled: typeof lineId === 'number' && lineId > 0 && processId.length > 0 && partId.length > 0,
  })
}
