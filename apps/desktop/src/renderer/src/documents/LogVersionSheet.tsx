import { useState, type JSX } from 'react'
import { formatVersionId, stageLabel, workingVersion } from '@suna/core'
import { useProjectStore } from '../state/project'
import { refreshDocuments, useDocumentsStore } from '../state/documents'
import { Sheet } from './Sheet'
import './documents.css'

/**
 * Log a version: copy the manuscript end-to-end — along with the code,
 * analysis and figures behind it — into
 * `manuscript/archive/v<stage>.<minor>/` and leave it there.
 *
 * The stage choice is the only decision, and it is the one the author already
 * makes in conversation — "that's the draft we circulated" vs "that's what we
 * submitted". Staying in the current stage is the default because most logs
 * are another draft.
 */
export function LogVersionSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const versions = useDocumentsStore((s) => s.versions)

  const current = workingVersion(versions)
  const [stage, setStage] = useState<number>(current.stage)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const target = workingVersion(versions, stage)
  const targetId = formatVersionId(target)

  // Stages worth offering: the ones already used, the current one, and the
  // next one up. Listing every integer would be noise, and a manuscript
  // cannot jump from an internal draft to a third review round.
  const stages = Array.from(new Set([0, 1, current.stage, current.stage + 1])).sort(
    (a, b) => a - b
  )

  const log = async (): Promise<void> => {
    if (rootDir === null || busy) return
    setBusy(true)
    setError(null)
    try {
      await window.suna.invoke('version:log', { dir: rootDir, stage, note: note.trim() })
      refreshDocuments()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Sheet label="Log version" narrow onClose={onClose}>
      <header className="sheet__head">
        <h2>Log version</h2>
        <button className="sheet__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="sheet__body">
        <p className="sheet__hint">
          Keeps a complete copy of the manuscript as it stands right now, together with
          the code, analysis and figures behind it. The copy is read-only; you keep
          working on the latest version.
        </p>

        <fieldset className="sheet__field">
          <legend>This version is</legend>
          {stages.map((s) => (
            <label className="sheet__radio" key={s}>
              <input
                type="radio"
                name="version-stage"
                checked={stage === s}
                onChange={() => setStage(s)}
              />
              <span>
                {stageLabel(s)}
                <em>{formatVersionId(workingVersion(versions, s))}</em>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="sheet__field">
          <label htmlFor="version-note">Note</label>
          <input
            id="version-note"
            type="text"
            value={note}
            placeholder="What this version was — optional"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error !== null && <p className="sheet__error">{error}</p>}
      </div>

      <footer className="sheet__foot">
        <span className="sheet__path">manuscript/archive/{targetId}/</span>
        <div className="sheet__actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="is-primary"
            onClick={() => void log()}
            disabled={busy || rootDir === null}
          >
            {busy ? 'Copying…' : `Log ${targetId}`}
          </button>
        </div>
      </footer>
    </Sheet>
  )
}
