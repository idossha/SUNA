import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ResponseOf } from '@suna/core'
import { classifyDiffLine } from './diff'
import {
  absoluteTime,
  authorColor,
  DOT_R,
  edgePath,
  gutterWidth,
  initials,
  laneX,
  relativeTime,
  ROW_H
} from './timeline'

type Graph = ResponseOf<'git:graph'>
type Commit = Graph['commits'][number]
type Row = Graph['rows'][number]
type Ref = Commit['refs'][number]
type CommitDetail = ResponseOf<'git:show-commit'>

/**
 * A commit's author, as a coloured disc of initials.
 *
 * Deliberately drawn locally rather than fetched from a Gravatar or GitHub
 * avatar URL: the timeline must render with no network, and a manuscript's
 * co-author list should not become a set of requests to a third party every
 * time somebody opens the panel.
 */
function Avatar({ name, email }: { name: string; email: string }): JSX.Element {
  const color = authorColor(email, name)
  return (
    <span
      className={`gt__avatar gt__c${color}`}
      title={email === '' ? name : `${name} <${email}>`}
      aria-hidden="true"
    >
      {initials(name, email)}
    </span>
  )
}

/** Branch, tag and remote labels sitting on a commit. */
function RefChip({ refItem }: { refItem: Ref }): JSX.Element {
  const label =
    refItem.kind === 'tag' ? refItem.name : refItem.name.replace(/^origin\//, '↑ ')
  return (
    <span className={`gt__ref gt__ref--${refItem.kind}`} title={refItem.name}>
      {label}
    </span>
  )
}

/**
 * The lane drawing for one row: every line crossing the band, then the dot.
 *
 * An unpushed commit is a hollow ring and a pushed one is filled — the same
 * distinction GitHub Desktop draws, and the one that answers "is this on the
 * server" without reading any text.
 */
function LaneCell({
  row,
  laneCount,
  pushed
}: {
  row: Row
  laneCount: number
  pushed: boolean
}): JSX.Element {
  const width = gutterWidth(laneCount)
  return (
    <svg
      className="gt__lanes"
      width={width}
      height={ROW_H}
      viewBox={`0 0 ${width} ${ROW_H}`}
      aria-hidden="true"
    >
      {row.edges.map((edge, index) => (
        <path
          key={index}
          className={`gt__edge gt__s${edge.color % 8}`}
          d={edgePath(edge.fromLane, edge.toLane, row.lane)}
        />
      ))}
      <circle
        className={`gt__dot gt__f${row.color % 8} ${pushed ? '' : 'gt__dot--local'}`}
        cx={laneX(row.lane)}
        cy={ROW_H / 2}
        r={DOT_R}
      />
    </svg>
  )
}

/** The files one commit touched, with its patch underneath. */
function CommitDetailBlock({ detail }: { detail: CommitDetail | null }): JSX.Element {
  if (detail === null) return <p className="view__hint gt__detail-hint">Reading commit…</p>
  return (
    <div className="gt__detail">
      <div className="gt__files">
        {detail.files.map((file) => (
          <div key={file.path} className="gt__file" title={file.path}>
            <span className="gt__file-path">{file.path}</span>
            <span className="gt__file-stat">
              {file.added > 0 && <span className="gt__plus">+{file.added}</span>}
              {file.removed > 0 && <span className="gt__minus">−{file.removed}</span>}
            </span>
          </div>
        ))}
      </div>
      {detail.diff.trim() !== '' && (
        <pre className="git__diff gt__diff">
          {detail.diff.split('\n').map((line, index) => (
            <div key={index} className={`git__diff-line--${classifyDiffLine(line)}`}>
              {line === '' ? ' ' : line}
            </div>
          ))}
        </pre>
      )}
    </div>
  )
}

/**
 * The history, as a graph rather than a list.
 *
 * Two things it has to make obvious at a glance, because they are the two
 * questions people actually open it with: which commits are still only on
 * this machine, and — when several people are writing — whose line of work is
 * whose. The first is the hollow-dot/solid-dot split plus the "not pushed"
 * rule; the second is the lane colours and the author discs.
 */
export function GitTimeline({
  rootDir,
  refreshKey,
  onError
}: {
  rootDir: string
  refreshKey: number
  onError: (message: string) => void
}): JSX.Element {
  const [graph, setGraph] = useState<Graph | null>(null)
  const [scope, setScope] = useState<'current' | 'all'>('all')
  const [limit, setLimit] = useState(60)
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<CommitDetail | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await window.suna.invoke('git:graph', { dir: rootDir, limit, scope })
      setGraph(next)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }, [rootDir, limit, scope, onError])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const toggle = async (hash: string): Promise<void> => {
    if (open === hash) {
      setOpen(null)
      setDetail(null)
      return
    }
    setOpen(hash)
    setDetail(null)
    try {
      setDetail(await window.suna.invoke('git:show-commit', { dir: rootDir, hash }))
    } catch (err) {
      setDetail({ diff: '', files: [] })
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  if (graph === null) return <p className="view__hint">Reading history…</p>
  if (graph.commits.length === 0) {
    return <p className="view__hint">No commits yet. The first one starts the history.</p>
  }

  const rowByHash = new Map(graph.rows.map((row) => [row.hash, row]))
  const unpushed = graph.commits.filter((commit) => !commit.pushed).length
  // The rule goes above the first pushed commit, but only when unpushed ones
  // sit above it — otherwise it is a line separating nothing from everything.
  const boundary =
    unpushed > 0 ? (graph.commits.find((commit) => commit.pushed)?.hash ?? null) : null

  return (
    <div className="gt">
      <div className="gt__head">
        <span className="view__section-title">History</span>
        <div className="gt__head-actions">
          <button
            className={`gt__scope ${scope === 'all' ? 'gt__scope--on' : ''}`}
            title={
              scope === 'all'
                ? 'Showing every branch, including co-authors’ — click for this branch only'
                : 'Showing this branch only — click to include every branch'
            }
            onClick={() => setScope((value) => (value === 'all' ? 'current' : 'all'))}
          >
            {scope === 'all' ? 'All branches' : 'This branch'}
          </button>
        </div>
      </div>

      <div className="gt__rows">
        {graph.commits.map((commit) => {
          const row = rowByHash.get(commit.hash)
          if (row === undefined) return null
          const isOpen = open === commit.hash
          return (
            <div key={commit.hash}>
              {commit.hash === boundary && (
                <div className="gt__boundary">
                  <span>{unpushed === 1 ? '1 commit above is' : `${unpushed} commits above are`} not on the remote yet</span>
                </div>
              )}
              <button
                className={`gt__row ${isOpen ? 'gt__row--open' : ''} ${commit.pushed ? '' : 'gt__row--local'}`}
                aria-expanded={isOpen}
                onClick={() => void toggle(commit.hash)}
              >
                <LaneCell row={row} laneCount={graph.laneCount} pushed={commit.pushed} />
                <span className="gt__body">
                  <span className="gt__subject-line">
                    {commit.refs.map((refItem) => (
                      <RefChip key={`${refItem.kind}:${refItem.name}`} refItem={refItem} />
                    ))}
                    <span className="gt__subject">{commit.subject}</span>
                  </span>
                  <span className="gt__meta">
                    <Avatar name={commit.author} email={commit.email} />
                    <span className="gt__author">{commit.author}</span>
                    <span className="gt__time" title={absoluteTime(commit.date)}>
                      {relativeTime(commit.date)}
                    </span>
                    <span className="gt__hash">{commit.hash.slice(0, 7)}</span>
                  </span>
                </span>
              </button>
              {isOpen && <CommitDetailBlock detail={detail} />}
            </div>
          )
        })}
      </div>

      {graph.truncated && (
        <button className="gt__more" onClick={() => setLimit((value) => value + 100)}>
          Show older commits
        </button>
      )}
    </div>
  )
}
