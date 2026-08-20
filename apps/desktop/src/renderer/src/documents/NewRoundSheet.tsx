import { useMemo, useState, type JSX } from 'react'
import type { RoundKind } from '@suna/core'
import { getBundledProfile } from '@suna/formatter'
import { useProjectStore } from '../state/project'
import { refreshDocuments, useDocumentsStore } from '../state/documents'
import { openRoundTab } from '../state/dock'
import { Sheet } from './Sheet'
import './documents.css'

/**
 * New development round (document-kinds-ux.md §D.1).
 *
 * A round is the unit a manuscript actually moves in — an internal
 * circulation to co-authors, or an external submission/review cycle. Both
 * kinds exist here because the artefacts differ (a co-author gets a marked-up
 * DOCX back; an editor sends reviewer reports) but the ledger is the same.
 */
export function NewRoundSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const activeProfileId = useProjectStore((s) => s.manifest?.activeProfileId ?? null)
  const rounds = useDocumentsStore((s) => s.rounds)

  const venueName = useMemo(
    () => (activeProfileId === null ? null : (getBundledProfile(activeProfileId)?.journalName ?? null)),
    [activeProfileId]
  )

  const [kind, setKind] = useState<RoundKind>('external')
  const nextNumber = rounds.length + 1
  const [label, setLabel] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const defaultLabel =
    kind === 'external'
      ? `Round ${nextNumber}${venueName === null ? '' : ` — ${venueName}`}`
      : `Internal round ${nextNumber}`
  const effectiveLabel = label.trim() === '' ? defaultLabel : label.trim()
  const id = `round-${nextNumber}`

  const create = async (): Promise<void> => {
    if (rootDir === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const { round } = await window.suna.invoke('round:new', {
        dir: rootDir,
        id,
        kind,
        label: effectiveLabel,
        venue: kind === 'external' ? venueName : null
      })
      refreshDocuments()
      openRoundTab(rootDir, round.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Sheet label="New round" narrow onClose={onClose}>
      <header className="sheet__head">
        <h2>New round</h2>
        <button className="sheet__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="sheet__body">
        <fieldset className="sheet__field">
          <legend>Kind</legend>
          <label className="sheet__radio">
            <input
              type="radio"
              name="round-kind"
              checked={kind === 'external'}
              onChange={() => setKind('external')}
            />
            <span>
              External
              <em>A submission, its reviewer reports, and the revision that answers them</em>
            </span>
          </label>
          <label className="sheet__radio">
            <input
              type="radio"
              name="round-kind"
              checked={kind === 'internal'}
              onChange={() => setKind('internal')}
            />
            <span>
              Internal
              <em>A draft circulated to co-authors, and what comes back</em>
            </span>
          </label>
        </fieldset>

        <div className="sheet__field">
          <label htmlFor="round-label">Label</label>
          <input
            id="round-label"
            type="text"
            value={label}
            placeholder={defaultLabel}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        {error !== null && <p className="sheet__error">{error}</p>}
      </div>

      <footer className="sheet__foot">
        <span className="sheet__path">rounds/{id}/</span>
        <div className="sheet__actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="is-primary" onClick={() => void create()} disabled={busy || rootDir === null}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </footer>
    </Sheet>
  )
}
