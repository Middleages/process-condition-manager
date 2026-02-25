import client from './client'

export interface EquipmentOption {
  id: number
  equipment_name: string
  equipment_model: string | null
}

export async function fetchEquipments(lineId: number): Promise<EquipmentOption[]> {
  const { data } = await client.get<EquipmentOption[]>('/equipments', {
    params: { line_id: lineId },
  })
  return data
}
