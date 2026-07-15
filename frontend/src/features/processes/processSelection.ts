interface ProcessSelectionCandidate {
  key: string
}

export function getSettledProcessSelection(
  selectedProcessKey: string | null,
  processes: readonly ProcessSelectionCandidate[],
): string | null {
  if (
    selectedProcessKey !== null &&
    processes.some((process) => process.key === selectedProcessKey)
  ) {
    return selectedProcessKey
  }

  return processes[0]?.key ?? null
}
