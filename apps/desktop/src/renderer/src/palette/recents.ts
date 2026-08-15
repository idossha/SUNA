/**
 * Recent-entry persistence for the command palette (feature-plan-4 §5):
 * "Recent entries persist per project (last 20) and appear on an empty
 * input." Stored via the existing 'settings:set' bag under a key namespaced
 * by project root, alongside the app's other per-project overrides — never a
 * new IPC channel, and never through the closed `GlobalSettings` type (that
 * interface is the editor zone's contract; this key is dynamic per project,
 * so it goes through the raw `settings:get`/`settings:set` record directly).
 */

export type RecentEntryKind = 'file' | 'command' | 'terminal' | 'ai'

export interface RecentEntry {
  kind: RecentEntryKind
  /** What replaying this entry acts on: a file path, a command id, a shell line, or an ai prompt. */
  value: string
  /** What the list row shows. */
  label: string
  at: number
}

export const RECENTS_CAP = 20

/**
 * Pure: prepend `entry`, dropping any earlier entry with the same
 * (kind, value) so re-running something moves it to the top instead of
 * duplicating it, then cap at RECENTS_CAP.
 */
export function pushRecent(existing: readonly RecentEntry[], entry: RecentEntry): RecentEntry[] {
  const deduped = existing.filter((e) => !(e.kind === entry.kind && e.value === entry.value))
  return [entry, ...deduped].slice(0, RECENTS_CAP)
}

function recentsKey(rootDir: string): string {
  return `palette.recents.${rootDir}`
}

function isRecentEntry(value: unknown): value is RecentEntry {
  if (typeof value !== 'object' || value === null) return false
  const o = value as Record<string, unknown>
  return (
    (o['kind'] === 'file' || o['kind'] === 'command' || o['kind'] === 'terminal' || o['kind'] === 'ai') &&
    typeof o['value'] === 'string' &&
    typeof o['label'] === 'string' &&
    typeof o['at'] === 'number'
  )
}

/** Tolerant reader: a missing/garbled stored value reads as no recents rather than throwing. */
export function parseStoredRecents(value: unknown): RecentEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecentEntry).slice(0, RECENTS_CAP)
}

export async function loadRecents(rootDir: string): Promise<RecentEntry[]> {
  try {
    const { settings } = await window.suna.invoke('settings:get', {})
    return parseStoredRecents(settings[recentsKey(rootDir)])
  } catch {
    return []
  }
}

export async function saveRecents(rootDir: string, recents: readonly RecentEntry[]): Promise<void> {
  try {
    await window.suna.invoke('settings:set', { patch: { [recentsKey(rootDir)]: recents } })
  } catch {
    // best-effort persistence — the in-memory list still applies this session
  }
}
