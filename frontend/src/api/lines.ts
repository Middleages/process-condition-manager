import client from './client'
import type { Line } from '@/types'

export const fetchLines = () =>
  client.get<Line[]>('/lines').then((r) => r.data)
