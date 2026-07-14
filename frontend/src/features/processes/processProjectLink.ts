import type { ProcessDetailOut } from '@/api/types'
import {
  serializeProjectCreateSearch,
  toProjectListHref,
} from '@/features/projects/urlState'

export function getProcessProjectHref(process: ProcessDetailOut): string {
  if (process.has_project) {
    return toProjectListHref({
      query: process.process_id,
      status: 'all',
      deviceTypeCode: null,
      projectCategoryCode: null,
    })
  }

  const search = serializeProjectCreateSearch({
    step: 1,
    processKey: process.key,
    backboneId: null,
  }).toString()

  return `/projects/new?${search}`
}
