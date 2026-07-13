export function parsePositiveInt(raw: string | null | undefined): number | null {
  if (!raw) return null

  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
