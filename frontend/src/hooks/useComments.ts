import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createComment,
  fetchComments,
  updateComment,
  deleteComment,
} from '@/api/comments'
import {
  updateProjectStatus,
  fetchChangeSummary,
  fetchStatusHistory,
} from '@/api/projects'
import { projectKeys } from './useProjects'
import type {
  CommentCreate,
  CommentUpdate,
  StatusTransitionRequest,
} from '@/types'

export const commentKeys = {
  all: ['comments'] as const,
  list: (projectId: number) => [...commentKeys.all, 'list', projectId] as const,
  changeSummary: (projectId: number) => ['change-summary', projectId] as const,
  statusHistory: (projectId: number) => ['status-history', projectId] as const,
}

export function useComments(projectId: number) {
  return useQuery({
    queryKey: commentKeys.list(projectId),
    queryFn: () => fetchComments(projectId),
    enabled: projectId > 0,
  })
}

export function useCreateComment(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: CommentCreate) => createComment(projectId, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.list(projectId) })
    },
  })
}

export function useUpdateComment(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ commentId, req }: { commentId: number; req: CommentUpdate }) =>
      updateComment(projectId, commentId, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.list(projectId) })
    },
  })
}

export function useDeleteComment(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: number) => deleteComment(projectId, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.list(projectId) })
    },
  })
}

export function useStatusTransition(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: StatusTransitionRequest) => updateProjectStatus(projectId, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
      queryClient.invalidateQueries({ queryKey: commentKeys.list(projectId) })
      queryClient.invalidateQueries({ queryKey: commentKeys.statusHistory(projectId) })
    },
  })
}

export function useChangeSummary(projectId: number) {
  return useQuery({
    queryKey: commentKeys.changeSummary(projectId),
    queryFn: () => fetchChangeSummary(projectId),
    enabled: projectId > 0,
  })
}

export function useStatusHistory(projectId: number) {
  return useQuery({
    queryKey: commentKeys.statusHistory(projectId),
    queryFn: () => fetchStatusHistory(projectId),
    enabled: projectId > 0,
  })
}
