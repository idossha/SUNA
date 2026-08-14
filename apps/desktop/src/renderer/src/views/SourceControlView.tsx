import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ResponseOf } from '@suna/core'
import { useProjectStore } from '../state/project'
import { useUiStore } from '../state/ui'
import { classifyDiffLine, relativeToRoot, STATUS_LETTERS } from './diff'
import './views.css'

type GitStatus = ResponseOf<'git:status'>
type GitLogEntry = ResponseOf<'git:log'>['entries'][number]

function DiffBlock({ diff }: { diff: string }): JSX.Element {
  if (diff.trim() === '') {
    return <p className="view__hint">No diff to show (new or binary file).</p>
  }
  return (
    <pre className="git__diff">
      {diff.split('\n').map((line, i) => (
        <div key={i} className={`git__diff-line--${classifyDiffLine(line)}`}>
          {line === '' ? ' ' : line}
        </div>
      ))}
    </pre>
  )
}

export function SourceControlView(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const setStatusNote = useUiStore((s) => s.setStatusNote)

  const [status, setStatus] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitLogEntry[]>([])
  const [message, setMessage] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (rootDir === null) return
    try {
      const next = await window.suna.invoke('git:status', { dir: rootDir })
      setStatus(next)
      setError(null)
      if (next.isRepo) {
        const { entries } = await window.suna.invoke('git:log', { dir: rootDir, limit: 20 })
        setLog(entries)
      } else {
        setLog([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [rootDir])

  useEffect(() => {
    setStatus(null)
    setSelectedPath(null)
    setDiff(null)
    void refresh()
  }, [refresh])

  const showDiff = async (path: string): Promise<void> => {
    if (rootDir === null) return
    if (selectedPath === path) {
      setSelectedPath(null)
      setDiff(null)
      return
    }
    setSelectedPath(path)
    setDiff(null)
    try {
      const res = await window.suna.invoke('git:diff-file', { dir: rootDir, path })
      setDiff(res.diff)
    } catch (err) {
      setDiff(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const initRepo = async (): Promise<void> => {
    if (rootDir === null) return
    setWorking(true)
    try {
      await window.suna.invoke('git:init', { dir: rootDir })
      setStatusNote('Initialized a git repository')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }

  const commitAll = async (): Promise<void> => {
    if (rootDir === null || message.trim() === '') return
    setWorking(true)
    try {
      const { hash } = await window.suna.invoke('git:commit', {
        dir: rootDir,
        message: message.trim(),
        stageAll: true
      })
      setMessage('')
      setSelectedPath(null)
      setDiff(null)
      setStatusNote(`Committed ${hash.slice(0, 7)}`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWorking(false)
    }
  }

  if (status === null) {
    return (
      <div className="view">
        {error !== null ? <div className="view__error">{error}</div> : <p className="view__hint">Reading repository…</p>}
      </div>
    )
  }

  if (!status.isRepo) {
    return (
      <div className="view">
        <p className="view__hint">
          This project folder is not a git repository yet. Version control keeps every state of
          your manuscript recoverable.
        </p>
        <button className="btn btn--primary" disabled={working} onClick={() => void initRepo()}>
          Initialize repository
        </button>
        {error !== null && <div className="view__error">{error}</div>}
      </div>
    )
  }

  return (
    <div className="view">
      <div className="git__branch">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="7" cy="6" r="2.2" />
          <circle cx="7" cy="18" r="2.2" />
          <circle cx="17" cy="9" r="2.2" />
          <path d="M7 8.2v7.6M17 11.2c0 3-3.5 3.3-7.2 3.6" />
        </svg>
        <span>{status.branch ?? 'detached HEAD'}</span>
      </div>

      {error !== null && <div className="view__error">{error}</div>}

      <div>
        <div className="view__section-title">
          Changes{status.changes.length > 0 ? ` · ${status.changes.length}` : ''}
        </div>
        {status.changes.length === 0 ? (
          <p className="view__hint">Working tree clean.</p>
        ) : (
          <div>
            {status.changes.map((change) => (
              <div key={change.path}>
                <button
                  className="git__row"
                  aria-selected={selectedPath === change.path}
                  title={`${change.status}: ${change.path}`}
                  onClick={() => void showDiff(change.path)}
                >
                  <span
                    className={`git__letter git__letter--${(STATUS_LETTERS[change.status] ?? '?').toLowerCase()}`}
                  >
                    {STATUS_LETTERS[change.status] ?? '?'}
                  </span>
                  <span className="git__path">
                    {rootDir !== null ? relativeToRoot(change.path, rootDir) : change.path}
                  </span>
                </button>
                {selectedPath === change.path && diff !== null && <DiffBlock diff={diff} />}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="git__commit">
        <textarea
          className="view__textarea"
          placeholder="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button
          className="btn btn--primary"
          disabled={working || message.trim() === '' || status.changes.length === 0}
          onClick={() => void commitAll()}
        >
          Commit all
        </button>
      </div>

      {log.length > 0 && (
        <div>
          <div className="view__section-title">History</div>
          <div className="git__log">
            {log.map((entry) => (
              <div key={entry.hash} className="git__log-row" title={`${entry.author} · ${entry.date}`}>
                <span className="git__hash">{entry.hash.slice(0, 7)}</span>
                <span className="git__subject">{entry.subject}</span>
                <span className="git__log-meta">{entry.date.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
