import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '../lib/cn'

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'tabIndex'> {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  ...headerProps
}: PageHeaderProps) {
  return (
    <header
      {...headerProps}
      className={cn(
        'flex flex-col gap-3 border-b border-border-subtle pb-4 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-semibold text-brand-700">{eyebrow}</div> : null}
        <h1
          className="text-2xl font-bold tracking-tight text-ink-950 focus:outline-none sm:text-[1.75rem]"
          data-page-title
          tabIndex={-1}
        >
          {title}
        </h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
