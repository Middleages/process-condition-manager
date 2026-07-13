import type { AriaAttributes, HTMLAttributes } from 'react'

import { cn } from '../lib/cn'

export type InlineAlertTone = 'info' | 'success' | 'warning' | 'error'

export interface InlineAlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'aria-live' | 'role'> {
  tone: InlineAlertTone
  live?: AriaAttributes['aria-live']
}

const ROLE = {
  info: { role: 'status', live: 'polite' },
  success: { role: 'status', live: 'polite' },
  warning: { role: 'status', live: 'polite' },
  error: { role: 'alert', live: 'assertive' },
} as const

const TONE_CLASSES: Record<InlineAlertTone, string> = {
  info: 'border-border-subtle bg-surface text-ink-950',
  success: 'border-success bg-success-surface text-success',
  warning: 'border-warning bg-warning-surface text-warning',
  error: 'border-error bg-error-surface text-error',
}

export function InlineAlert({ tone, live, className, children, ...alertProps }: InlineAlertProps) {
  const semantics = ROLE[tone]

  return (
    <div
      {...alertProps}
      aria-atomic="true"
      aria-live={live ?? semantics.live}
      className={cn('rounded-lg border p-3 text-sm font-medium', TONE_CLASSES[tone], className)}
      role={semantics.role}
    >
      {children}
    </div>
  )
}
