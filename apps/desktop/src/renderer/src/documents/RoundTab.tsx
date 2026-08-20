import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { Diagnostic } from '@suna/formatter'
import type { PointStatus, ReviewerReport, Round } from '@suna/core'
import { isAddressed, pointStateFor, roundProgress } from '@suna/core'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { openReviewImportTab } from '../state/dock'
import { refreshDocuments } from '../state/documents'
import './documents.css'

/**
 * The response workspace (document-kinds-ux.md §C).
 *
 * Three panes, because the task is irreducibly three-sided: the reviewer's
 * point, your reply, and the manuscript you changed. The middle pane's top
 * half is the point — read-only, with no edit affordance anywhere, because
 * editing a reviewer's words is misconduct and the UI should make it
 * impossible rather than merely discouraged.
 *
 * `rebutted` sits beside `done` as a first-class outcome. Every real response
 * letter disagrees with something, and a tool that models only compliance
 * quietly pressures authors into conceding points they should defend.
 */

const STATUSES: { id: PointStatus; label: string; hint: string }[] = [
  { id: 'unaddressed', label: 'Unaddressed', hint: 'Not yet answered' },
  { id: 'drafted', label: 'Drafted', hint: 'A reply exists but is not finished' },
  { id: 'done', label: 'Done', hint: 'Answered, and the manuscript changed if it needed to' },
  { id: 'rebutted', label: 'Rebutted', hint: 'We disagree, and the reply says why' }
]

export function RoundTab({ params }: DockPanelProps): JSX.Element {
  const rootDir = String(params?.['rootDir'] ?? '')
  const roundId = String(params?.['roundId'] ?? '')

  const [round, setRound] = useState<Round | null>(null)
  const [reports, setReports] = useState<ReviewerReport[]>([])
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [mineOnly, setMineOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await window.suna.invoke('round:read', { dir: rootDir, roundId })
      setRound(res.round)
      setReports(res.reports)
      const check = await window.suna.invoke('review:check', { dir: rootDir, roundId })
      setDiagnostics(check.diagnostics as Diagnostic[])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [rootDir, roundId])

  useEffect(() => {
    void load()
  }, [load])

  const progress = useMemo(
    () => (round === null ? null : roundProgress(round, reports)),
    [round, reports]
  )

  const setStatus = async (pointId: string, status: PointStatus): Promise<void> => {
    if (round === null) return
    try {
      const res = await window.suna.invoke('review:set-point', {
        dir: rootDir,
        roundId,
        pointId,
        status
      })
      setRound(res.round)
      const check = await window.suna.invoke('review:check', { dir: rootDir, roundId })
      setDiagnostics(check.diagnostics as Diagnostic[])
      refreshDocuments()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const setAssignee = async (pointId: string, assignee: string | null): Promise<void> => {
    if (round === null) return
    const current = pointStateFor(round, pointId)
    try {
      const res = await window.suna.invoke('review:set-point', {
        dir: rootDir,
        roundId,
        pointId,
        status: current.status,
        assignee
      })
      setRound(res.round)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (error !== null && round === null) {
    return <div className="round round--empty">{error}</div>
  }
  if (round === null) return <div className="round round--empty">Loading…</div>

  const totalPoints = reports.reduce((n, r) => n + r.points.length, 0)

  if (totalPoints === 0) {
    return (
      <div className="round round--empty">
        <h2>{round.label}</h2>
        <p>No reviewer comments have been imported into this round yet.</p>
        <button className="is-primary" onClick={() => openReviewImportTab(rootDir)}>
          Import reviewer comments…
        </button>
      </div>
    )
  }

  const activePoint =
    selected === null
      ? null
      : (reports.flatMap((r) => r.points).find((p) => p.id === selected) ?? null)
  const activeState = activePoint === null ? null : pointStateFor(round, activePoint.id)

  return (
    <div className="round">
      <header className="round__head">
        <div>
          <h2>{round.label}</h2>
          <span className="round__sub">
            {round.kind === 'external' ? 'External' : 'Internal'} · {round.state}
            {round.venue !== null && ` · ${round.venue}`}
          </span>
        </div>
        {progress !== null && (
          <div className="round__progress">
            <strong>
              {progress.addressed} of {progress.total}
            </strong>{' '}
            points addressed
          </div>
        )}
      </header>

      <div className="round__cols">
        {/* ---- points list ------------------------------------------------ */}
        <nav className="round__list">
          <label className="round__filter">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            Only points with an assignee
          </label>
          {reports.map((report) => {
            const rp = progress?.byReviewer.find((b) => b.index === report.index)
            return (
              <section key={report.index}>
                <h3>
                  Reviewer {report.index}
                  <span className="round__dots" aria-label={`${rp?.addressed ?? 0} of ${rp?.total ?? 0}`}>
                    {report.points.map((p) => (
                      <i
                        key={p.id}
                        className={isAddressed(pointStateFor(round, p.id).status) ? 'is-on' : ''}
                      />
                    ))}
                  </span>
                </h3>
                <ul>
                  {report.points
                    .filter((p) => !mineOnly || pointStateFor(round, p.id).assignee !== null)
                    .map((p) => {
                      const st = pointStateFor(round, p.id)
                      return (
                        <li key={p.id}>
                          <button
                            className={`round__pt${selected === p.id ? ' is-selected' : ''} is-${st.status}`}
                            onClick={() => setSelected(p.id)}
                          >
                            <span className="round__pt-id">
                              {report.index}.{p.pointIndex}
                            </span>
                            <span className="round__pt-text">
                              {p.verbatim.replace(/\s+/g, ' ').trim().slice(0, 70)}
                            </span>
                            {st.assignee !== null && (
                              <span className="round__pt-who">{st.assignee}</span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                </ul>
              </section>
            )
          })}
        </nav>

        {/* ---- the point, and what you do about it ------------------------ */}
        <section className="round__detail">
          {activePoint === null || activeState === null ? (
            <p className="round__hint">Choose a point on the left.</p>
          ) : (
            <>
              <div className="round__verbatim">
                <header>
                  Reviewer {activePoint.reviewerIndex}, point {activePoint.pointIndex}
                  {activePoint.section !== null && ` · ${activePoint.section}`}
                  <span className="round__locked" title="A reviewer's words are never editable">
                    verbatim
                  </span>
                </header>
                {/*
                  Deliberately not a textarea, not a disabled input, not a
                  contentEditable with a guard — there is no edit control here
                  at all. The only operations on a reviewer's text are split
                  and merge, at import, and both re-derive from the source.
                */}
                <blockquote>{activePoint.verbatim}</blockquote>
              </div>

              <div className="round__status">
                {STATUSES.map((s) => (
                  <button
                    key={s.id}
                    className={`round__st is-${s.id}${activeState.status === s.id ? ' is-on' : ''}`}
                    title={s.hint}
                    onClick={() => void setStatus(activePoint.id, s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="round__assign">
                <label htmlFor="round-assignee">Assignee</label>
                <input
                  id="round-assignee"
                  type="text"
                  placeholder="initials"
                  defaultValue={activeState.assignee ?? ''}
                  key={activePoint.id}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    void setAssignee(activePoint.id, v === '' ? null : v)
                  }}
                  onKeyDown={(e) => {
                    // Blur alone is a papercut: typing initials and pressing
                    // Enter should visibly do something, not nothing.
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') {
                      e.currentTarget.value = activeState.assignee ?? ''
                      e.currentTarget.blur()
                    }
                  }}
                />
                <span className="round__assign-hint">
                  Replaces the colour-coded initials people maintain by hand.
                </span>
              </div>

              <div className="round__reply-hint">
                Write the reply in the response document and name this point with{' '}
                <code>@point:{activePoint.id}</code> — the completeness check reads that, and the
                page and line reference is derived at export rather than typed.
              </div>
            </>
          )}
        </section>

        {/* ---- what is still missing -------------------------------------- */}
        <aside className="round__problems">
          <h3>
            Before you send
            {diagnostics.length > 0 && <span className="round__badge">{diagnostics.length}</span>}
          </h3>
          {diagnostics.length === 0 ? (
            <p className="round__ok">Every reviewer point is addressed.</p>
          ) : (
            <ul>
              {diagnostics.map((d, i) => (
                <li key={i} className={`round__diag is-${d.severity}`}>
                  <button
                    onClick={() => d.target?.pointId !== undefined && setSelected(d.target.pointId)}
                  >
                    {d.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error !== null && <p className="sheet__error">{error}</p>}
        </aside>
      </div>
    </div>
  )
}
