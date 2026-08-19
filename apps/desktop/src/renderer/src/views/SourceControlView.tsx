import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { ResponseOf } from '@suna/core'
import { useProjectStore } from '../state/project'
import { useUiStore } from '../state/ui'
import { classifyDiffLine, relativeToRoot, STATUS_LETTERS } from './diff'
import { GitBranchBar } from './GitBranches'
import { GitConflictPanel } from './GitConflicts'
import { GitRemoteSection } from './GitRemote'
import { buildTrail, SyncTrail, type StageTone } from './GitSyncTrail'
import { GitTimeline } from './GitTimeline'
import './views.css'

type GitStatus = ResponseOf<'git:status'>
type GitChange = GitStatus['staged'][number]
type RemoteInfo = ResponseOf<'git:remote'>
type ConflictState = ResponseOf<'git:conflict-state'>
type Side = 'staged' | 'unstaged'

/** Coalesce the burst a single git command produces before re-reading. */
const REFRESH_DEBOUNCE_MS = 80

/**
 * How often the panel quietly fetches, so "3 to push / 1 behind" describes the
 * remote as it is rather than as it was whenever someone last ran git by hand.
 * Quiet failures are ignored on purpose — a laptop on a plane should not
 * produce an error every few minutes.
 */
const AUTO_FETCH_MS = 5 * 60 * 1000

/**
 * Split a rendered diff into its hunks so each can carry its own actions.
 * Lines before the first `@@` are the file header, which is shown but never
 * actionable on its own.
 */
export function splitHunks(diff: string): { header: string[]; hunks: string[][] } {
  const header: string[] = []
  const hunks: string[][] = []
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      hunks.push([line])
      continue
    }
    if (hunks.length === 0) header.push(line)
    else hunks[hunks.length - 1]?.push(line)
  }
  return { header, hunks }
}

function DiffLines({ lines }: { lines: string[] }): JSX.Element {
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className={`git__diff-line--${classifyDiffLine(line)}`}>
          {line === '' ? ' ' : line}
        </div>
      ))}
    </>
  )
}

/**
 * The diff for one file, hunk by hunk. Each hunk carries the same actions the
 * file row does — partial staging, as in VS Code: commit the paragraph you
 * finished without committing the half-written one beneath it.
 */
function DiffBlock({
  diff,
  side,
  busy,
  onHunk
}: {
  diff: string
  side: Side
  busy: boolean
  onHunk: (index: number, action: 'stage' | 'unstage' | 'discard') => void
}): JSX.Element {
  if (diff.trim() === '') {
    return <p className="view__hint">No diff to show (new or binary file).</p>
  }
  const { header, hunks } = splitHunks(diff)
  return (
    <pre className="git__diff">
      <DiffLines lines={header} />
      {hunks.map((lines, index) => (
        <div key={index} className="git__hunk">
          <div className="git__hunk-bar">
            <span className="git__hunk-label">{lines[0]}</span>
            <div className="git__row-actions">
              {side === 'unstaged' && (
                <button
                  className="git__icon-btn"
                  disabled={busy}
                  title="Discard this hunk"
                  aria-label={`Discard hunk ${index + 1}`}
                  onClick={() => onHunk(index, 'discard')}
                >
                  <Icon kind="discard" />
                </button>
              )}
              <button
                className="git__icon-btn"
                disabled={busy}
                title={side === 'staged' ? 'Unstage this hunk' : 'Stage this hunk'}
                aria-label={`${side === 'staged' ? 'Unstage' : 'Stage'} hunk ${index + 1}`}
                onClick={() => onHunk(index, side === 'staged' ? 'unstage' : 'stage')}
              >
                <Icon kind={side === 'staged' ? 'unstage' : 'stage'} />
              </button>
            </div>
          </div>
          <DiffLines lines={lines.slice(1)} />
        </div>
      ))}
    </pre>
  )
}

type IconKind = 'stage' | 'unstage' | 'discard' | 'fetch' | 'pull' | 'push'

function Icon({ kind }: { kind: IconKind }): JSX.Element {
  const path =
    kind === 'stage'
      ? 'M12 5v14M5 12h14'
      : kind === 'unstage'
        ? 'M5 12h14'
        : kind === 'discard'
          ? 'M5 13a7 7 0 1 0 2-5M5 4v4h4'
          : kind === 'fetch'
            ? 'M20 11a8 8 0 1 0-2 5m2 3v-5h-5'
            : kind === 'pull'
              ? 'M12 4v12m0 0l-4-4m4 4l4-4M5 20h14'
              : 'M12 20V8m0 0L8 12m4-4l4 4M5 4h14'
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * One changed file. Mirrors VS Code's row: status letter, path, and the
 * actions for the side it is on — stage/discard on the working tree, unstage
 * on the index. Discard asks first, inline: it is the only action here that
 * destroys work, and an inline confirm keeps it from being a reflex click
 * while never opening a modal the app would have to own.
 */
function ChangeRow({
  change,
  side,
  rootDir,
  selected,
  busy,
  confirming,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
  onConfirmDiscard,
  onCancelDiscard
}: {
  change: GitChange
  side: Side
  rootDir: string
  selected: boolean
  busy: boolean
  confirming: boolean
  onSelect: () => void
  onStage: () => void
  onUnstage: () => void
  onDiscard: () => void
  onConfirmDiscard: () => void
  onCancelDiscard: () => void
}): JSX.Element {
  const letter = STATUS_LETTERS[change.status] ?? '?'
  return (
    <div className="git__file">
      <div className="git__row-wrap">
        <button
          className="git__row"
          aria-selected={selected}
          title={`${change.status}: ${change.path}`}
          onClick={onSelect}
        >
          <span className={`git__letter git__letter--${letter.toLowerCase()}`}>{letter}</span>
          <span className="git__path">{relativeToRoot(change.path, rootDir)}</span>
        </button>
        <div className="git__row-actions">
          {side === 'unstaged' && (
            <button
              className="git__icon-btn"
              disabled={busy}
              title="Discard changes to this file"
              aria-label={`Discard changes to ${change.path}`}
              onClick={onDiscard}
            >
              <Icon kind="discard" />
            </button>
          )}
          <button
            className="git__icon-btn"
            disabled={busy}
            title={side === 'staged' ? 'Unstage this file' : 'Stage this file'}
            aria-label={`${side === 'staged' ? 'Unstage' : 'Stage'} ${change.path}`}
            onClick={side === 'staged' ? onUnstage : onStage}
          >
            <Icon kind={side === 'staged' ? 'unstage' : 'stage'} />
          </button>
        </div>
      </div>
      {confirming && (
        <div className="git__confirm">
          <span>
            {change.status === 'untracked'
              ? 'Delete this untracked file? This cannot be undone.'
              : 'Throw away the changes to this file?'}
          </span>
          <div className="git__confirm-actions">
            <button className="btn btn--danger" disabled={busy} onClick={onConfirmDiscard}>
              {change.status === 'untracked' ? 'Delete file' : 'Discard'}
            </button>
            <button className="btn" disabled={busy} onClick={onCancelDiscard}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function SourceControlView(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const setStatusNote = useUiStore((s) => s.setStatusNote)

  const [status, setStatus] = useState<GitStatus | null>(null)
  const [remote, setRemote] = useState<RemoteInfo | null>(null)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [message, setMessage] = useState('')
  const [amending, setAmending] = useState(false)
  const [selected, setSelected] = useState<{ path: string; side: Side } | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null)
  const [confirmUndo, setConfirmUndo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  /** Bumped after every mutation; children reload when it changes. */
  const [refreshKey, setRefreshKey] = useState(0)

  const timer = useRef<number | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (rootDir === null) return
    try {
      const next = await window.suna.invoke('git:status', { dir: rootDir })
      setStatus(next)
      setError(null)
      if (next.isRepo) {
        const [info, conflicts] = await Promise.all([
          window.suna.invoke('git:remote', { dir: rootDir }),
          window.suna.invoke('git:conflict-state', { dir: rootDir })
        ])
        setRemote(info)
        setConflict(conflicts)
      } else {
        setRemote(null)
        setConflict(null)
      }
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [rootDir])

  /** Debounced, so one git command's burst of events costs one status read. */
  const scheduleRefresh = useCallback((): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      void refresh()
    }, REFRESH_DEBOUNCE_MS)
  }, [refresh])

  useEffect(() => {
    setStatus(null)
    setSelected(null)
    setDiff(null)
    setConfirmDiscard(null)
    setAmending(false)
    setMessage('')
    void refresh()
  }, [refresh])

  /**
   * Live, whoever moved the repository: `.git` for staging/commits/checkouts
   * (including from the built-in terminal or an agent), the project tree for
   * ordinary edits, and window focus as the backstop for anything a platform's
   * file watching misses while the app is in the background.
   */
  useEffect(() => {
    if (rootDir === null) return undefined
    const stale = (dir: string): boolean => dir !== rootDir
    const offGit = window.suna.onGitChanged?.(({ dir }) => {
      if (!stale(dir)) scheduleRefresh()
    })
    const offTree = window.suna.onProjectTreeChanged?.(({ dir }) => {
      if (!stale(dir)) scheduleRefresh()
    })
    const onFocus = (): void => scheduleRefresh()
    window.addEventListener('focus', onFocus)
    return () => {
      offGit?.()
      offTree?.()
      window.removeEventListener('focus', onFocus)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [rootDir, scheduleRefresh])

  /**
   * Quiet background fetch. Without it the ahead/behind counts are a reading
   * of whenever someone last fetched by hand, which is worse than no counts
   * because it looks current. Failures are swallowed: offline is normal.
   */
  useEffect(() => {
    if (rootDir === null || status?.isRepo !== true) return undefined
    let cancelled = false
    const run = async (): Promise<void> => {
      const res = await window.suna.invoke('git:fetch', { dir: rootDir }).catch(() => null)
      if (cancelled || res === null || !res.fetched) return
      const info = await window.suna.invoke('git:remote', { dir: rootDir }).catch(() => null)
      if (!cancelled && info !== null) setRemote(info)
    }
    void run()
    const interval = window.setInterval(() => void run(), AUTO_FETCH_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
    // Re-armed when the project changes or it first becomes a repository.
  }, [rootDir, status?.isRepo])

  const showDiff = async (path: string, side: Side): Promise<void> => {
    if (rootDir === null) return
    if (selected !== null && selected.path === path && selected.side === side) {
      setSelected(null)
      setDiff(null)
      return
    }
    setSelected({ path, side })
    setDiff(null)
    try {
      const res = await window.suna.invoke('git:diff-file', { dir: rootDir, path, side })
      setDiff(res.diff)
    } catch (err) {
      setDiff(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Every mutating action runs through here: one busy flag, one error path. */
  const act = async (run: () => Promise<string | null>): Promise<void> => {
    setWorking(true)
    setError(null)
    try {
      const note = await run()
      if (note !== null) setStatusNote(note)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }

  const stage = (paths: string[]): Promise<void> =>
    act(async () => {
      if (rootDir === null) return null
      await window.suna.invoke('git:stage', { dir: rootDir, paths })
      return null
    })

  const unstage = (paths: string[]): Promise<void> =>
    act(async () => {
      if (rootDir === null) return null
      await window.suna.invoke('git:unstage', { dir: rootDir, paths })
      return null
    })

  const discard = (paths: string[]): Promise<void> =>
    act(async () => {
      if (rootDir === null) return null
      const res = await window.suna.invoke('git:discard', {
        dir: rootDir,
        paths,
        deleteUntracked: true
      })
      setConfirmDiscard(null)
      setSelected(null)
      setDiff(null)
      const parts = [
        res.reverted.length > 0 ? `${res.reverted.length} reverted` : null,
        res.deleted.length > 0 ? `${res.deleted.length} deleted` : null
      ].filter((p) => p !== null)
      return parts.length > 0 ? `Discarded: ${parts.join(', ')}` : null
    })

  const applyHunk = (
    path: string,
    index: number,
    action: 'stage' | 'unstage' | 'discard'
  ): Promise<void> =>
    act(async () => {
      if (rootDir === null) return null
      await window.suna.invoke('git:apply-hunk', { dir: rootDir, path, index, action })
      // The remaining hunks renumber, so re-read the diff that is still open.
      if (selected !== null) {
        const res = await window.suna
          .invoke('git:diff-file', { dir: rootDir, path: selected.path, side: selected.side })
          .catch(() => null)
        setDiff(res?.diff ?? null)
      }
      return null
    })

  const initRepo = async (): Promise<void> => {
    if (rootDir === null) return
    setWorking(true)
    try {
      const res = await window.suna.invoke('git:init', { dir: rootDir })
      setStatusNote(
        res.committed
          ? 'Initialized a git repository'
          : 'Initialized a git repository (no commit yet)'
      )
      setError(res.warning)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }

  const commit = (stageAll: boolean): Promise<void> =>
    act(async () => {
      if (rootDir === null) return null
      const { hash } = await window.suna.invoke('git:commit', {
        dir: rootDir,
        message: message.trim(),
        stageAll,
        amend: amending
      })
      const wasAmend = amending
      setMessage('')
      setAmending(false)
      setSelected(null)
      setDiff(null)
      return `${wasAmend ? 'Amended' : 'Committed'} ${hash.slice(0, 7)}`
    })

  /** Load the last message into the box and switch the button to Amend. */
  const startAmend = (): Promise<void> =>
    act(async () => {
      if (rootDir === null) return null
      const res = await window.suna.invoke('git:last-message', { dir: rootDir })
      setMessage(res.message)
      setAmending(true)
      return null
    })

  const undoCommit = (): Promise<void> =>
    act(async () => {
      if (rootDir === null) return null
      const res = await window.suna.invoke('git:undo-commit', { dir: rootDir })
      setConfirmUndo(false)
      setMessage(res.subject)
      return `Undid “${res.subject}” — its changes are staged again`
    })

  const fetchNow = (): Promise<void> =>
    act(async () => {
      if (rootDir === null) return null
      const res = await window.suna.invoke('git:fetch', { dir: rootDir })
      if (res.error !== null) throw new Error(res.error)
      if (!res.fetched) return 'No remote to check.'
      return res.behind > 0
        ? `${res.behind} new ${res.behind === 1 ? 'commit' : 'commits'} on the remote`
        : 'Up to date with the remote'
    })

  const pull = (): Promise<void> =>
    act(async () => {
      if (rootDir === null) return null
      const res = await window.suna.invoke('git:pull', { dir: rootDir, mode: 'rebase' })
      if (!res.clean) {
        return `Pull stopped on ${res.conflicted.length} conflicted ${res.conflicted.length === 1 ? 'file' : 'files'}`
      }
      return res.alreadyUpToDate ? 'Already up to date' : 'Pulled the remote’s commits'
    })

  const push = (): Promise<void> =>
    act(async () => {
      if (rootDir === null) return null
      const res = await window.suna.invoke('git:push', { dir: rootDir })
      return res.setUpstream
        ? `Published ${res.branch} to ${res.remote}`
        : `Pushed ${res.branch} to ${res.remote}`
    })

  if (status === null) {
    return (
      <div className="view">
        {error !== null ? (
          <div className="view__error">{error}</div>
        ) : (
          <p className="view__hint">Reading repository…</p>
        )}
      </div>
    )
  }

  if (!status.isRepo) {
    return (
      <div className="view">
        <p className="view__hint">
          This project folder is not a git repository yet. Version control keeps every state of your
          manuscript recoverable — initializing creates a repository here, on the <code>main</code>{' '}
          branch, and records everything currently in the folder as a first commit. Nothing leaves
          your machine until you add a remote and push.
        </p>
        <button className="btn btn--primary" disabled={working} onClick={() => void initRepo()}>
          Initialize repository
        </button>
        {error !== null && <div className="view__error">{error}</div>}
      </div>
    )
  }

  const hasMessage = message.trim() !== ''
  const unstagedPaths = status.unstaged.map((c) => c.path)
  const nothingToCommit = status.staged.length === 0 && status.unstaged.length === 0
  const ahead = remote?.ahead ?? 0
  const behind = remote?.behind ?? 0
  const hasRemote = remote?.url != null
  const unpublished = hasRemote && remote?.upstream === null && remote?.hasCommits === true
  const inConflict = conflict !== null && (conflict.operation !== 'none' || conflict.paths.length > 0)

  const trail = buildTrail({
    unstaged: status.unstaged.length,
    staged: status.staged.length,
    ahead,
    hasRemote
  })

  /** Clicking a trail stage takes you to the thing it counts. */
  const jumpTo = (tone: StageTone): void => {
    const id =
      tone === 'working' ? 'git-unstaged' : tone === 'staged' ? 'git-staged' : 'git-history'
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const section = (side: Side, changes: GitChange[]): JSX.Element | null => {
    if (changes.length === 0) return null
    const paths = changes.map((c) => c.path)
    return (
      <div id={side === 'staged' ? 'git-staged' : 'git-unstaged'}>
        <div className="git__section-head">
          <span className="view__section-title">
            {side === 'staged' ? 'Staged — ready to commit' : 'Changed — not staged'} ·{' '}
            {changes.length}
          </span>
          <div className="git__row-actions">
            {side === 'unstaged' && (
              <button
                className="git__icon-btn"
                disabled={working}
                title="Discard all changes"
                aria-label="Discard all changes"
                onClick={() => setConfirmDiscard('*')}
              >
                <Icon kind="discard" />
              </button>
            )}
            <button
              className="git__icon-btn"
              disabled={working}
              title={side === 'staged' ? 'Unstage everything' : 'Stage everything'}
              aria-label={side === 'staged' ? 'Unstage everything' : 'Stage everything'}
              onClick={() => void (side === 'staged' ? unstage(paths) : stage(paths))}
            >
              <Icon kind={side === 'staged' ? 'unstage' : 'stage'} />
            </button>
          </div>
        </div>
        {side === 'unstaged' && confirmDiscard === '*' && (
          <div className="git__confirm">
            <span>
              Throw away every change in the working tree? Untracked files are deleted, and this
              cannot be undone.
            </span>
            <div className="git__confirm-actions">
              <button
                className="btn btn--danger"
                disabled={working}
                onClick={() => void discard(unstagedPaths)}
              >
                Discard all
              </button>
              <button className="btn" disabled={working} onClick={() => setConfirmDiscard(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <div>
          {changes.map((change) => (
            <div key={`${side}:${change.path}`}>
              <ChangeRow
                change={change}
                side={side}
                rootDir={rootDir ?? ''}
                busy={working}
                selected={selected?.path === change.path && selected.side === side}
                confirming={side === 'unstaged' && confirmDiscard === change.path}
                onSelect={() => void showDiff(change.path, side)}
                onStage={() => void stage([change.path])}
                onUnstage={() => void unstage([change.path])}
                onDiscard={() => setConfirmDiscard(change.path)}
                onConfirmDiscard={() => void discard([change.path])}
                onCancelDiscard={() => setConfirmDiscard(null)}
              />
              {selected?.path === change.path && selected.side === side && diff !== null && (
                <DiffBlock
                  diff={diff}
                  side={side}
                  busy={working}
                  onHunk={(index, action) => void applyHunk(change.path, index, action)}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="view">
      {rootDir !== null && (
        <GitBranchBar
          rootDir={rootDir}
          refreshKey={refreshKey}
          busy={working}
          operation={conflict?.operation ?? 'none'}
          incoming={conflict?.incoming ?? null}
          onChanged={refresh}
          onError={setError}
          setStatusNote={setStatusNote}
        />
      )}

      <SyncTrail stages={trail} behind={behind} onSelect={jumpTo} />

      <div className="git__sync-actions">
        <button
          className="btn git__sync-btn"
          disabled={working || !hasRemote}
          title="Check the remote for new commits"
          onClick={() => void fetchNow()}
        >
          <Icon kind="fetch" />
          Fetch
        </button>
        <button
          className={`btn git__sync-btn ${behind > 0 && !inConflict ? 'btn--primary' : ''}`}
          disabled={working || !hasRemote || behind === 0 || inConflict}
          title={
            inConflict
              ? 'Finish or call off the operation in progress first'
              : behind === 0
                ? 'Nothing to pull'
                : `Bring down ${behind} ${behind === 1 ? 'commit' : 'commits'} from the remote`
          }
          onClick={() => void pull()}
        >
          <Icon kind="pull" />
          Pull{behind > 0 ? ` ${behind}` : ''}
        </button>
        <button
          className={`btn git__sync-btn ${(ahead > 0 || unpublished) && !inConflict ? 'btn--primary' : ''}`}
          disabled={working || !hasRemote || (ahead === 0 && !unpublished) || inConflict}
          title={
            inConflict
              ? 'Finish or call off the operation in progress first'
              : !hasRemote
                ? 'Add a remote first'
                : unpublished
                  ? 'Publish this branch to the remote'
                  : ahead === 0
                    ? 'Nothing to push'
                    : `Send ${ahead} ${ahead === 1 ? 'commit' : 'commits'} to the remote`
          }
          onClick={() => void push()}
        >
          <Icon kind="push" />
          {unpublished ? 'Publish' : `Push${ahead > 0 ? ` ${ahead}` : ''}`}
        </button>
      </div>

      {error !== null && <div className="view__error">{error}</div>}

      {inConflict && conflict !== null && rootDir !== null && (
        <GitConflictPanel
          rootDir={rootDir}
          state={conflict}
          busy={working}
          onRun={act}
          onOpenFile={(path) => {
            void window.suna
              .invoke('shell:open-path', { path: `${rootDir}/${path}` })
              .catch(() => null)
          }}
        />
      )}

      <div className="git__commit">
        <textarea
          className="view__textarea"
          placeholder={amending ? 'Amended commit message' : 'Commit message'}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="git__commit-actions">
          <button
            className="btn btn--primary"
            disabled={working || !hasMessage || (status.staged.length === 0 && !amending)}
            title={amending ? 'Replace the last commit' : 'Commit the staged changes'}
            onClick={() => void commit(false)}
          >
            {amending ? 'Amend commit' : 'Commit'}
          </button>
          {!amending && status.staged.length === 0 && status.unstaged.length > 0 && (
            <button
              className="btn"
              disabled={working || !hasMessage}
              title="Stage every change, then commit"
              onClick={() => void commit(true)}
            >
              Stage all &amp; commit
            </button>
          )}
          {amending && (
            <button
              className="btn"
              disabled={working}
              onClick={() => {
                setAmending(false)
                setMessage('')
              }}
            >
              Cancel amend
            </button>
          )}
        </div>

        {/* Rewriting the last commit is only safe while it is still local. */}
        {!amending && ahead > 0 && !inConflict && (
          <div className="git__commit-extra">
            <button className="git__link-btn" disabled={working} onClick={() => void startAmend()}>
              Reword last commit
            </button>
            <button className="git__link-btn" disabled={working} onClick={() => setConfirmUndo(true)}>
              Undo last commit
            </button>
          </div>
        )}
        {confirmUndo && (
          <div className="git__confirm">
            <span>
              Take the last commit apart? Nothing you wrote is lost — its changes come back as
              staged, ready to commit again.
            </span>
            <div className="git__confirm-actions">
              <button className="btn btn--danger" disabled={working} onClick={() => void undoCommit()}>
                Undo it
              </button>
              <button className="btn" disabled={working} onClick={() => setConfirmUndo(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {hasMessage && !amending && status.staged.length === 0 && status.unstaged.length > 0 && (
          <p className="view__hint">
            Nothing is staged. Stage the files you want in this commit, or use “Stage all &amp;
            commit”.
          </p>
        )}
      </div>

      {nothingToCommit ? (
        <p className="view__hint">Working tree clean.</p>
      ) : (
        <>
          {section('staged', status.staged)}
          {section('unstaged', status.unstaged)}
        </>
      )}

      <div id="git-history">
        {rootDir !== null && (
          <GitTimeline rootDir={rootDir} refreshKey={refreshKey} onError={setError} />
        )}
      </div>

      {rootDir !== null && (
        <GitRemoteSection
          rootDir={rootDir}
          refreshKey={refreshKey}
          onChanged={refresh}
          setStatusNote={setStatusNote}
        />
      )}
    </div>
  )
}
