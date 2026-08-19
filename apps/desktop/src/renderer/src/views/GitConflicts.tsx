import { useState, type JSX } from 'react'
import type { ResponseOf } from '@suna/core'
import { relativeToRoot } from './diff'

type ConflictState = ResponseOf<'git:conflict-state'>
type Operation = ConflictState['operation']

/**
 * Which side is whose, in words, for the operation actually running.
 *
 * This is the single most common way a conflict gets resolved backwards:
 * during a rebase git's "ours" is the branch you are landing ON (the incoming
 * work) and "theirs" is your own commits being replayed — exactly the reverse
 * of a merge. Nobody should have to remember that, so the buttons never say
 * "ours" or "theirs" at all.
 */
export function sideLabels(operation: Operation): { ours: string; theirs: string } {
  if (operation === 'rebase') {
    return { ours: 'the incoming version', theirs: 'your version' }
  }
  return { ours: 'your version', theirs: 'the incoming version' }
}

export function operationName(operation: Operation): string {
  if (operation === 'rebase') return 'rebase'
  if (operation === 'cherry-pick') return 'cherry-pick'
  if (operation === 'revert') return 'revert'
  return 'merge'
}

/**
 * The panel that appears when git stops mid-operation.
 *
 * It sits above everything else in Source Control because nothing else in the
 * repository can proceed until it is dealt with, and because a half-finished
 * rebase that the user does not realise they are in is the state most likely
 * to end with them losing work in a terminal.
 */
export function GitConflictPanel({
  rootDir,
  state,
  busy,
  onRun,
  onOpenFile
}: {
  rootDir: string
  state: ConflictState
  busy: boolean
  onRun: (run: () => Promise<string | null>) => void | Promise<void>
  onOpenFile: (path: string) => void
}): JSX.Element | null {
  const [confirmAbort, setConfirmAbort] = useState(false)
  /** Unstaged files git is refusing to continue past; see git-sync.ts. */
  const [blocked, setBlocked] = useState<string[]>([])

  if (state.operation === 'none' && state.paths.length === 0) return null

  const labels = sideLabels(state.operation)
  const name = operationName(state.operation)
  const remaining = state.paths.length

  const resolve = (path: string, side: 'ours' | 'theirs'): void => {
    void onRun(async () => {
      await window.suna.invoke('git:resolve-conflict', { dir: rootDir, path, side })
      return null
    })
  }

  const markResolved = (path: string): void => {
    void onRun(async () => {
      await window.suna.invoke('git:mark-resolved', { dir: rootDir, path })
      return null
    })
  }

  const carryOn = (setAside: boolean): void => {
    void onRun(async () => {
      const res = await window.suna.invoke('git:continue', { dir: rootDir, setAside })
      setBlocked(res.blocked)
      return res.done ? `Finished the ${name}` : null
    })
  }

  const abort = (): void => {
    void onRun(async () => {
      const res = await window.suna.invoke('git:abort', { dir: rootDir })
      setConfirmAbort(false)
      return `Called off the ${operationName(res.operation)}`
    })
  }

  return (
    <div className="gc">
      <div className="gc__head">
        <span className="gc__badge">Conflict</span>
        <span className="gc__title">
          {remaining === 0
            ? `The ${name} is ready to finish.`
            : `A ${name} stopped on ${remaining} ${remaining === 1 ? 'file' : 'files'}.`}
        </span>
      </div>

      {state.incoming !== null && (
        <p className="view__hint gc__incoming">
          Bringing in <strong>{state.incoming}</strong>.
        </p>
      )}

      {remaining > 0 && (
        <p className="view__hint">
          git could not decide between two versions of these files. Pick a side, or open the file
          and edit it into the version you want — then mark it resolved.
        </p>
      )}

      <div className="gc__files">
        {state.paths.map((path) => (
          <div key={path} className="gc__file">
            <button
              className="gc__path"
              title={`Open ${path}`}
              onClick={() => onOpenFile(path)}
            >
              {relativeToRoot(path, rootDir)}
            </button>
            <div className="gc__actions">
              <button
                className="btn"
                disabled={busy}
                title={`Keep ${labels.ours} of this file and discard the other`}
                onClick={() => resolve(path, 'ours')}
              >
                Keep {labels.ours}
              </button>
              <button
                className="btn"
                disabled={busy}
                title={`Keep ${labels.theirs} of this file and discard the other`}
                onClick={() => resolve(path, 'theirs')}
              >
                Keep {labels.theirs}
              </button>
              <button
                className="btn"
                disabled={busy}
                title="I edited this file by hand; it is done"
                onClick={() => markResolved(path)}
              >
                Mark resolved
              </button>
            </div>
          </div>
        ))}
      </div>

      {/*
        git refuses `rebase --continue` while ANY file has unstaged edits, even
        ones untouched by the conflict — and says "you must edit all merge
        conflicts", which is simply not what is wrong. Say what is, and offer
        the fix that does not fold unrelated work into the replayed commit.
      */}
      {blocked.length > 0 && (
        <div className="git__warn">
          <p>
            Every conflict is resolved, but git will not finish a {name} while other files have
            unsaved edits — even ones this {name} never touched:
          </p>
          <ul className="gc__blocked">
            {blocked.map((path) => (
              <li key={path}>{relativeToRoot(path, rootDir)}</li>
            ))}
          </ul>
          <button className="btn btn--primary" disabled={busy} onClick={() => carryOn(true)}>
            Set them aside and finish
          </button>
          <p className="view__hint">
            Their changes are stashed, the {name} finishes, and they come straight back — they stay
            out of the commit either way.
          </p>
        </div>
      )}

      <div className="gc__foot">
        <button
          className="btn btn--primary"
          disabled={busy || remaining > 0}
          title={
            remaining > 0
              ? 'Resolve every file first'
              : `Finish the ${name} and carry on`
          }
          onClick={() => carryOn(false)}
        >
          Finish {name}
        </button>
        <button className="btn" disabled={busy} onClick={() => setConfirmAbort(true)}>
          Call it off
        </button>
      </div>

      {confirmAbort && (
        <div className="git__confirm">
          <span>
            Undo the whole {name} and put the repository back where it was? Anything you resolved
            in it is discarded; your own commits are untouched.
          </span>
          <div className="git__confirm-actions">
            <button className="btn btn--danger" disabled={busy} onClick={abort}>
              Call off the {name}
            </button>
            <button className="btn" disabled={busy} onClick={() => setConfirmAbort(false)}>
              Keep going
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
