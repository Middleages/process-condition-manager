import type { HTMLAttributes } from 'react'

import { cn } from '../lib/cn'

export type BadgeTone = 'neutral' | 'draft' | 'warning' | 'error' | 'read-only'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: BadgeTone
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'border-border-subtle bg-canvas text-muted',
  draft: 'border-brand-700 bg-brand-100 text-brand-700',
  warning: 'border-warning bg-warning-surface text-warning',
  error: 'border-error bg-error-surface text-error',
  'read-only': 'border-border-control bg-canvas text-ink-950',
}

export function Badge({ tone, className, children, ...badgeProps }: BadgeProps) {
  return (
    <span
      {...badgeProps}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold leading-4',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
