/**
 * Next-available id when duplicating a figure — computed up front from the
 * manuscript's existing figure ids (never trial-and-error against the IPC),
 * so "Duplicate figure" needs no prompt/modal (canvas parity spec §3.3).
 */

export function nextCopyId(baseId: string, attempt: number): string {
  return attempt === 0 ? `${baseId}-copy` : `${baseId}-copy-${attempt + 1}`
}

export function pickAvailableId(
  baseId: string,
  taken: ReadonlySet<string>,
  maxAttempts = 200
): string | null {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = nextCopyId(baseId, attempt)
    if (!taken.has(candidate)) return candidate
  }
  return null
}
