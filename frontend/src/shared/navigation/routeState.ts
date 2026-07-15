export function parsePositiveInt(raw: string | null | undefined): number | null {
  if (!raw) return null

  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function shouldBlockNavigation(
  when: boolean,
  currentUrl: string,
  nextUrl: string,
  allowPath?: string,
): boolean {
  if (!when || normalizeUrl(currentUrl) === normalizeUrl(nextUrl)) return false
  if (allowPath && pathnameOf(nextUrl) === pathnameOf(allowPath)) return false

  return true
}

function normalizeUrl(value: string): string {
  const url = new URL(value, 'https://navigation.local')
  return `${url.pathname}${url.search}${url.hash}`
}

function pathnameOf(value: string): string {
  return new URL(value, 'https://navigation.local').pathname
}
