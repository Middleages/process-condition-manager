import client from './client'
import type {
  CommentCreate,
  CommentUpdate,
  Comment,
  CommentListResponse,
} from '@/types'

export async function createComment(
  projectId: number,
  req: CommentCreate
): Promise<Comment> {
  const { data } = await client.post<Comment>(
    `/process-conditions/${projectId}/comments/`,
    req
  )
  return data
}

export async function fetchComments(
  projectId: number,
  params?: {
    is_resolved?: boolean
    comment_type?: string
    project_layer_id?: number
  }
): Promise<CommentListResponse> {
  const { data } = await client.get<CommentListResponse>(
    `/process-conditions/${projectId}/comments/`,
    { params }
  )
  return data
}

export async function updateComment(
  projectId: number,
  commentId: number,
  req: CommentUpdate
): Promise<Comment> {
  const { data } = await client.patch<Comment>(
    `/process-conditions/${projectId}/comments/${commentId}`,
    req
  )
  return data
}

export async function deleteComment(
  projectId: number,
  commentId: number
): Promise<void> {
  await client.delete(`/process-conditions/${projectId}/comments/${commentId}`)
}
