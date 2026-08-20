import { useCallback, useEffect, useState, type JSX } from 'react'
import { daysLeft, sortByDeletedAt, type TrashEntry } from '@suna/core'
import type { DockPanelProps } from './dock/DockHost'
import { useUiStore } from '../state/ui'
import { useProjectStore } from '../state/project'
import './trash.css'

/**
 * SUNA trash — the light files deleted from this project, and the way back.
 *
 * Scoped to one project because that is where the trash lives on disk
 * (`<project>/.suna/trash/`): a deleted draft belongs to the work it was
 * deleted from, travels with the folder when it is copied, and cannot outlive
 * the project it came from. The panel is keyed by rootDir for the same reason.
 */

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "today" / "3 days ago" — deletion time at the resolution anyone cares about. */
export function deletedLabel(entry: TrashEntry, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(entry.deletedAt).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export function expiryLabel(entry: TrashEntry, now: Date): string {
  const left = daysLeft(entry, now)
  if (left === 0) return 'due to be cleared'
  return left === 1 ? 'clears tomorrow' : `clears in ${left} days`
}

/** The folder a row came from, shown relative to its project when it is open. */
export function originLabel(entry: TrashEntry, rootDir: string | null): string {
  const dir = entry.originalPath.slice(0, entry.originalPath.lastIndexOf('/'))
  if (rootDir !== null && (dir === rootDir || dir.startsWith(`${rootDir}/`))) {
    const inside = dir.slice(rootDir.length + 1)
    return inside === '' ? `${rootDir.split('/').pop() ?? rootDir}/` : `${inside}/`
  }
  return `${dir}/`
}

export function TrashTab({ params }: DockPanelProps): JSX.Element {
  const rootDir = typeof params['rootDir'] === 'string' ? params['rootDir'] : null
  const [entries, setEntries] = useState<TrashEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingEmpty, setConfirmingEmpty] = useState(false)
  const setStatusNote = useUiStore((s) => s.setStatusNote)
  const now = new Date()

  const refresh = useCallback(async () => {
    if (rootDir === null) return
    const { entries: rows } = await window.suna.invoke('trash:list', { dir: rootDir })
    setEntries(sortByDeletedAt(rows))
  }, [rootDir])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const restore = async (ids: string[]): Promise<void> => {
    if (rootDir === null) return
    setBusy(true)
    try {
      const { restored, failed } = await window.suna.invoke('trash:restore', { dir: rootDir, ids })
      await refresh()
      // Restoring writes files back into the project, so the tree must catch up.
      if (restored.length > 0) await useProjectStore.getState().refreshTree()
      if (failed.length > 0) {
        setStatusNote(
          `Restored ${restored.length}; could not restore ${failed.length} — ${failed[0]?.reason ?? ''}`
        )
      } else {
        setStatusNote(
          restored.length === 1
            ? `Restored ${restored[0]?.path.split('/').pop() ?? ''}`
            : `Restored ${restored.length} files`
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async (ids: string[] | undefined): Promise<void> => {
    if (rootDir === null) return
    setBusy(true)
    try {
      const { removed } = await window.suna.invoke(
        'trash:empty',
        ids === undefined ? { dir: rootDir } : { dir: rootDir, ids }
      )
      await refresh()
      setStatusNote(
        removed === 1
          ? 'Moved 1 item to the system trash'
          : `Moved ${removed} items to the system trash`
      )
    } finally {
      setBusy(false)
      setConfirmingEmpty(false)
    }
  }

  return (
    <div className="view trash">
      <div className="trash__header">
        <h2 className="trash__title">Trash</h2>
        {entries !== null && entries.length > 0 && (
          <div className="trash__header-actions">
            <button
              type="button"
              className="trash__button"
              disabled={busy}
              onClick={() => void restore(entries.map((e) => e.id))}
            >
              Restore all
            </button>
            {confirmingEmpty ? (
              <>
                <button
                  type="button"
                  className="trash__button trash__button--danger"
                  disabled={busy}
                  onClick={() => void remove(undefined)}
                >
                  Move all to system trash
                </button>
                <button
                  type="button"
                  className="trash__button"
                  onClick={() => setConfirmingEmpty(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="trash__button"
                disabled={busy}
                onClick={() => setConfirmingEmpty(true)}
              >
                Empty trash
              </button>
            )}
          </div>
        )}
      </div>

      <p className="view__hint">
        Deleted files small enough to keep live in this project, under <code>.suna/trash/</code>
        {' '}(git-ignored). Emptying moves them to your system trash — SUNA never deletes them
        outright. Size and retention are in Settings.
      </p>

      {rootDir === null && <p className="view__hint">No project open.</p>}
      {rootDir !== null && entries === null && <p className="view__hint">Loading…</p>}
      {entries !== null && entries.length === 0 && (
        <p className="view__hint">Nothing in the trash.</p>
      )}

      {entries !== null && entries.length > 0 && (
        <ul className="trash__list">
          {entries.map((entry) => (
            <li key={entry.id} className="trash__row">
              <div className="trash__row-main">
                <span className="trash__name">{entry.name}</span>
                <span className="trash__origin" title={entry.originalPath}>
                  {originLabel(entry, rootDir)}
                </span>
              </div>
              <div className="trash__row-meta">
                <span>{humanSize(entry.bytes)}</span>
                <span>deleted {deletedLabel(entry, now)}</span>
                <span>{expiryLabel(entry, now)}</span>
              </div>
              <div className="trash__row-actions">
                <button
                  type="button"
                  className="trash__button"
                  disabled={busy}
                  onClick={() => void restore([entry.id])}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="trash__button"
                  disabled={busy}
                  onClick={() => void remove([entry.id])}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
