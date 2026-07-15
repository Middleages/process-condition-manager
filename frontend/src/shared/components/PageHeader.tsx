import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '../lib/cn'

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ eyebrow, title, description, actions, className, ...headerProps }: PageHeaderProps) {
  return (
    <header
      {...headerProps}
      className={cn(
        'flex flex-col gap-4 rounded-sm border-b border-border-subtle pb-5 focus:outline-2 focus:outline-offset-2 focus:outline-brand-700 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-semibold text-brand-700">{eyebrow}</div> : null}
        <h1 className="text-2xl font-bold tracking-tight text-ink-950 sm:text-[1.75rem]">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
