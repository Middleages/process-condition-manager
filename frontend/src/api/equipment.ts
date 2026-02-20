import client from './client'
import type { Equipment, EquipmentCreate } from '@/types/export'

// ========== Equipment CRUD ==========

export async function fetchEquipment(
  projectId: number,
  layerId: number
): Promise<Equipment[]> {
  const { data } = await client.get<Equipment[]>(
    `/projects/${projectId}/layers/${layerId}/equipment`
  )
  return data
}

export async function createEquipment(
  projectId: number,
  layerId: number,
  payload: EquipmentCreate
): Promise<Equipment> {
  const { data } = await client.post<Equipment>(
    `/projects/${projectId}/layers/${layerId}/equipment`,
    payload
  )
  return data
}

export async function updateEquipment(
  projectId: number,
  layerId: number,
  eqId: number,
  payload: Partial<EquipmentCreate>
): Promise<Equipment> {
  const { data } = await client.put<Equipment>(
    `/projects/${projectId}/layers/${layerId}/equipment/${eqId}`,
    payload
  )
  return data
}

export async function deleteEquipment(
  projectId: number,
  layerId: number,
  eqId: number
): Promise<void> {
  await client.delete(`/projects/${projectId}/layers/${layerId}/equipment/${eqId}`)
}

export async function reorderEquipment(
  projectId: number,
  layerId: number,
  orderedIds: number[]
): Promise<Equipment[]> {
  const { data } = await client.put<Equipment[]>(
    `/projects/${projectId}/layers/${layerId}/equipment/reorder`,
    { ordered_ids: orderedIds }
  )
  return data
}
