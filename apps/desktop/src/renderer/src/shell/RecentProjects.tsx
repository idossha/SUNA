import { useEffect, useState, type JSX } from 'react'
import type { RecentProjectEntry } from '@suna/core'
import { openProjectAt } from '../state/project'
import { toRecentProjectRow } from './recentsFormat'

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(record)) {
    if (k !== key) out[k] = v
  }
  return out
}

/**
 * Recent projects, listed under the welcome screen's actions (feature-plan-5
 * §1). Renders nothing while loading and nothing when the list is empty, so a
 * first-time install still shows today's plain welcome copy.
 *
 * Opening a row goes through state/project.ts's `openProjectAt` (feature-
 * plan-7 §3), the one function every project switch funnels through: it
 * closes tabs scoped to whatever project was open before, refreshes the
 * tree, and reloads comments for the new root — this file no longer
 * hand-rolls that sequence itself (see the title-bar Project menu for the
 * other caller).
 */
export function RecentProjects(): JSX.Element | null {
  const [entries, setEntries] = useState<RecentProjectEntry[] | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    void window.suna
      .invoke('project:recents', {})
      .then(({ recents }) => {
        if (!cancelled) setEntries(recents)
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const open = async (entry: RecentProjectEntry): Promise<void> => {
    setBusyPath(entry.path)
    setRowErrors((prev) => withoutKey(prev, entry.path))
    try {
      await openProjectAt(entry.path)
    } catch (error) {
      // Never a silent no-op: surface the failure inline and let the row
      // offer Remove even if its last-known `exists` said it was fine.
      setRowErrors((prev) => ({ ...prev, [entry.path]: errMessage(error) }))
      setEntries((prev) => prev?.map((e) => (e.path === entry.path ? { ...e, exists: false } : e)) ?? prev)
    } finally {
      setBusyPath(null)
    }
  }

  const remove = async (path: string): Promise<void> => {
    setBusyPath(path)
    try {
      const { recents } = await window.suna.invoke('project:forget-recent', { path })
      setEntries(recents)
      setRowErrors((prev) => withoutKey(prev, path))
    } catch (error) {
      setRowErrors((prev) => ({ ...prev, [path]: errMessage(error) }))
    } finally {
      setBusyPath(null)
    }
  }

  if (entries === null || entries.length === 0) return null

  return (
    <nav className="recents" aria-label="Recent projects">
      <div className="recents__title">Recent projects</div>
      <ul className="recents__list">
        {entries.map((entry) => {
          const row = toRecentProjectRow(entry)
          const rowError = rowErrors[entry.path] ?? null
          const busy = busyPath === entry.path
          return (
            <li className="recents__item" key={entry.path}>
              <button
                type="button"
                className={row.missing ? 'recents__row recents__row--missing' : 'recents__row'}
                disabled={busy}
                onClick={() => void open(entry)}
              >
                <span className="recents__name">{row.name}</span>
                <span className="recents__path">{row.parentPath}</span>
                <span className="recents__time">{row.timeLabel}</span>
                {row.missing && <span className="recents__badge">Missing</span>}
              </button>
              {row.missing && (
                <button
                  type="button"
                  className="recents__remove"
                  disabled={busy}
                  onClick={() => void remove(entry.path)}
                >
                  Remove
                </button>
              )}
              {rowError !== null && <div className="recents__error">{rowError}</div>}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
