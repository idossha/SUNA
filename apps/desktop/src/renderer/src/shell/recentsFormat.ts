import type { RecentProjectEntry } from '@suna/core'
import { relativeTime } from '../comments/relativeTime'

/**
 * The directory containing `path`, tolerating either separator style (a
 * recents entry can have been written on a different OS than it is read on,
 * since the list is just JSON in userData). Empty string when there is
 * nothing to split on.
 */
export function parentPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (idx < 0) return ''
  if (idx === 0) return trimmed.slice(0, 1) // POSIX root: keep the lone '/'
  return trimmed.slice(0, idx)
}

/** Presentation-ready view of one recents row — pure so it is unit-testable without a DOM. */
export interface RecentProjectRow {
  path: string
  name: string
  /** Dimmed under the name in the welcome-screen row. */
  parentPath: string
  /** e.g. "2h ago" (see relativeTime). */
  timeLabel: string
  /** The directory no longer holds a suna.json — render dimmed + "Missing". */
  missing: boolean
}

export function toRecentProjectRow(
  entry: RecentProjectEntry,
  now: number = Date.now()
): RecentProjectRow {
  return {
    path: entry.path,
    name: entry.name,
    parentPath: parentPath(entry.path),
    timeLabel: relativeTime(entry.lastOpenedAt, now),
    missing: !entry.exists
  }
}
