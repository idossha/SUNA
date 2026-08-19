import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { ResponseOf } from '@suna/core'
import { relativeTime } from './timeline'

type Branches = ResponseOf<'git:branches'>
type Branch = Branches['branches'][number]

type Operation = ResponseOf<'git:conflict-state'>['operation']

/**
 * What to call the current position.
 *
 * git genuinely detaches HEAD during a rebase, but "detached HEAD" is a
 * frightening thing to read for someone who only pressed Pull — and it is not
 * the useful fact. The useful fact is which branch is being replayed and what
 * is happening to it.
 */
export function headLabel(
  current: string | null,
  detached: boolean,
  operation: Operation,
  incoming: string | null
): string {
  const verb =
    operation === 'rebase'
      ? 'rebasing'
      : operation === 'merge'
        ? 'merging'
        : operation === 'cherry-pick'
          ? 'cherry-picking'
          : operation === 'revert'
            ? 'reverting'
            : null

  if (current !== null) return verb === null ? current : `${current} · ${verb}`
  if (!detached) return '…'
  // Mid-rebase there is no current branch; the operation records the one being
  // replayed, which is the name the user thinks of themselves as being on.
  if (verb !== null) return incoming === null ? verb : `${incoming} · ${verb}`
  return 'detached HEAD'
}

/** The branch icon, matching the one the panel header already uses. */
function BranchIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M7 8.2v7.6M17 11.2c0 3-3.5 3.3-7.2 3.6" />
    </svg>
  )
}

/**
 * One row of the switcher. A remote-only branch is labelled as such, because
 * switching to it does something slightly different (it creates a local
 * branch that tracks it) and the user should not be surprised by the new name.
 */
function BranchRow({
  branch,
  busy,
  onSwitch,
  onDelete
}: {
  branch: Branch
  busy: boolean
  onSwitch: () => void
  onDelete: (() => void) | null
}): JSX.Element {
  return (
    <div className={`gb__row ${branch.current ? 'gb__row--current' : ''}`}>
      <button
        className="gb__pick"
        disabled={busy || branch.current}
        title={
          branch.current
            ? 'Already on this branch'
            : branch.remote
              ? `Check out ${branch.name} as a local branch that tracks it`
              : `Switch to ${branch.name}`
        }
        onClick={onSwitch}
      >
        <span className="gb__mark">{branch.current ? '●' : branch.remote ? '↑' : '○'}</span>
        <span className="gb__name">
          {branch.name}
          {branch.remote && <span className="gb__tag">remote</span>}
        </span>
        <span className="gb__meta">
          {branch.ahead > 0 && <span className="gb__ahead">↑{branch.ahead}</span>}
          {branch.behind > 0 && <span className="gb__behind">↓{branch.behind}</span>}
          <span className="gb__when">{relativeTime(branch.date)}</span>
        </span>
        {branch.subject !== '' && <span className="gb__subject">{branch.subject}</span>}
      </button>
      {onDelete !== null && (
        <button
          className="git__icon-btn"
          disabled={busy}
          title={`Delete ${branch.name}`}
          aria-label={`Delete branch ${branch.name}`}
          onClick={onDelete}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

/**
 * Branch list, switcher and creator.
 *
 * Collapsed to a single line most of the time — a manuscript usually lives on
 * one branch and the switcher is not what the panel is for — but the current
 * branch and its drift are always on that line.
 */
export function GitBranchBar({
  rootDir,
  refreshKey,
  busy,
  operation,
  incoming,
  onChanged,
  onError,
  setStatusNote
}: {
  rootDir: string
  refreshKey: number
  busy: boolean
  /** The multi-step operation in flight, so the header can name it. */
  operation: Operation
  incoming: string | null
  onChanged: () => void | Promise<void>
  onError: (message: string) => void
  setStatusNote: (note: string) => void
}): JSX.Element {
  const [data, setData] = useState<Branches | null>(null)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [working, setWorking] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setData(await window.suna.invoke('git:branches', { dir: rootDir }))
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }, [rootDir, onError])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  const act = async (run: () => Promise<string | null>): Promise<void> => {
    setWorking(true)
    try {
      const note = await run()
      if (note !== null) setStatusNote(note)
      await load()
      await onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }

  const create = (): Promise<void> =>
    act(async () => {
      const res = await window.suna.invoke('git:create-branch', { dir: rootDir, name: name.trim() })
      setName('')
      setCreating(false)
      setOpen(false)
      return `Created and switched to ${res.branch}`
    })

  const switchTo = (branch: string): Promise<void> =>
    act(async () => {
      const res = await window.suna.invoke('git:switch-branch', { dir: rootDir, name: branch })
      setOpen(false)
      return res.created ? `Checked out ${res.branch}, tracking ${branch}` : `Switched to ${res.branch}`
    })

  const remove = (branch: string, force: boolean): Promise<void> =>
    act(async () => {
      const res = await window.suna.invoke('git:delete-branch', {
        dir: rootDir,
        name: branch,
        force
      })
      setConfirmDelete(null)
      return `Deleted ${res.branch}`
    })

  const current = data?.branches.find((branch) => branch.current) ?? null
  const disabled = busy || working

  return (
    <div className="gb">
      <div className="gb__bar">
        <button
          className="git__branch gb__toggle"
          aria-expanded={open}
          title="Branches"
          onClick={() => setOpen((value) => !value)}
        >
          <BranchIcon />
          <span className="gb__current">
            {headLabel(data?.current ?? null, data?.detached === true, operation, incoming)}
          </span>
          {current !== null && current.ahead > 0 && <span className="gb__ahead">↑{current.ahead}</span>}
          {current !== null && current.behind > 0 && <span className="gb__behind">↓{current.behind}</span>}
          <span className="gb__caret">{open ? '▾' : '▸'}</span>
        </button>
      </div>

      {open && data !== null && (
        <div className="gb__panel">
          {creating ? (
            <div className="gb__create">
              <input
                ref={inputRef}
                className="view__input"
                placeholder="new-branch-name"
                spellCheck={false}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && name.trim() !== '') void create()
                  if (event.key === 'Escape') setCreating(false)
                }}
              />
              <div className="git__guide-actions">
                <button
                  className="btn btn--primary"
                  disabled={disabled || name.trim() === ''}
                  onClick={() => void create()}
                >
                  Create branch
                </button>
                <button className="btn" disabled={disabled} onClick={() => setCreating(false)}>
                  Cancel
                </button>
              </div>
              <p className="view__hint">
                Branches from where you are now. Uncommitted work comes with you.
              </p>
            </div>
          ) : (
            <button className="btn gb__new" disabled={disabled} onClick={() => setCreating(true)}>
              + New branch
            </button>
          )}

          <div className="gb__list">
            {data.branches.map((branch) => (
              <div key={`${branch.remote ? 'r' : 'l'}:${branch.name}`}>
                <BranchRow
                  branch={branch}
                  busy={disabled}
                  onSwitch={() => void switchTo(branch.name)}
                  onDelete={
                    branch.current || branch.remote ? null : () => setConfirmDelete(branch.name)
                  }
                />
                {confirmDelete === branch.name && (
                  <div className="git__confirm">
                    <span>Delete {branch.name}?</span>
                    <div className="git__confirm-actions">
                      <button
                        className="btn"
                        disabled={disabled}
                        onClick={() => void remove(branch.name, false)}
                      >
                        Delete if merged
                      </button>
                      <button
                        className="btn btn--danger"
                        disabled={disabled}
                        onClick={() => void remove(branch.name, true)}
                        title="Delete even if it holds commits on no other branch"
                      >
                        Delete anyway
                      </button>
                      <button className="btn" disabled={disabled} onClick={() => setConfirmDelete(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
