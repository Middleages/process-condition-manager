import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { getProject } from '@/api/projects'
import type { SheetEditing } from '@/features/sheets/useSheetEditing'
import { parsePositiveInt } from '@/shared/navigation/routeState'

export type WorkspaceTab = 'sheet' | 'profile' | 'history'
export interface WorkspaceSession {
  editing: SheetEditing
  hasPaste: boolean
}
function useWorkspaceState(projectId: number) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<WorkspaceTab>('sheet')
  const [mutation, setMutation] = useState<'none' | 'handoff' | 'profile' | 'layer' | 'transition' | 'refresh'>('none')
  const mutationRef = useRef(mutation)
  const session = useRef<WorkspaceSession | null>(null)
  const [releaseFailed, setReleaseFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })
  const changeMutation = (value: typeof mutation) => { mutationRef.current = value; setMutation(value) }
  async function beginMutation(kind: 'profile' | 'layer' | 'transition') {
    if (mutationRef.current !== 'none') return false
    const current = session.current
    if (current && (current.hasPaste || current.editing.unsavedCount > 0 || !current.editing.persistenceIdle)) {
      setError('조건표의 입력을 저장하고 오류·붙여넣기를 해결한 후 다시 시도하세요.')
      return false
    }
    changeMutation('handoff')
    setReleaseFailed(false)
    setError(null)
    try {
      await current?.editing.suspend()
      changeMutation(kind)
      return true
    } catch (cause) {
      setReleaseFailed(true)
      setError(`편집 잠금을 해제하지 못했습니다. 다시 시도하세요. ${String(cause)}`)
      changeMutation('none')
      return false
    }
  }
  async function recoverEditing() {
    if (mutationRef.current !== 'none') return
    changeMutation('handoff')
    try {
      await session.current?.editing.suspend()
      setReleaseFailed(false)
      setError(null)
      session.current?.editing.resume()
    } catch (cause) {
      setError(`편집 잠금 해제 재시도 실패: ${String(cause)}`)
    } finally { changeMutation('none') }
  }
  async function endMutation() {
    changeMutation('refresh')
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }, { throwOnError: true }),
        queryClient.invalidateQueries({ queryKey: ['sheet', projectId] }, { throwOnError: true }),
      ])
      setError(null)
      changeMutation('none')
      session.current?.editing.resume()
    } catch (cause) {
      setError(`최신 정보를 불러오지 못해 편집을 중지했습니다. 다시 불러오세요. ${String(cause)}`)
    }
  }
  return { tab, setTab, mutation, session, error, releaseFailed, recoverEditing, beginMutation, endMutation, project: project.data }
}
const WorkspaceContext = createContext<ReturnType<typeof useWorkspaceState> | null>(null)
export const useProductWorkspace = () => useContext(WorkspaceContext)
export function ProductWorkspace({ projectId, children }: { projectId: number; children: ReactNode }) {
  const value = useWorkspaceState(projectId)
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
export function LegacyProjectRedirect() {
  const { projectId } = useParams()
  const location = useLocation()
  return <Navigate replace to={parsePositiveInt(projectId) === null ? '/projects' : `/projects/${projectId}/sheet`} state={location.state} />
}
