import type { ReactNode } from 'react'

export function LoadingMessage({ children = '불러오는 중...' }: { children?: ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4 text-slate-600 shadow-sm">{children}</div>
}

export function ErrorMessage({ message }: { message: string }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{message}</div>
}
