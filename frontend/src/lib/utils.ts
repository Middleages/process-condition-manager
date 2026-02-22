import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function isConditionValue(value: unknown): value is string | number | null {
  return value === null || typeof value === 'string' || typeof value === 'number'
}

export function getConditionValue(conditions: Record<string, unknown>, key: string): string | number | null {
  const value = conditions[key]
  return isConditionValue(value) ? value : null
}
