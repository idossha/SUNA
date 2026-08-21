import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { ReviewerReport, Round } from '@suna/core'
import { isAddressed, pointStateFor, roundProgress } from '@suna/core'
import { useProjectStore } from '../state/project'
import { openRoundTab } from '../state/dock'
import { focusRoundPoint, matchesPointFilter, useRoundFocusStore } from '../state/roundFocus'
import './documents.css'

/**
 * The lower panel while a round is selected — the point-by-point outline.
 *
 * It is the peer-review counterpart of the manuscript outline, and it is
 * there for the same reason: the panel below the document list describes the
 * structure of whatever you are working in. During a response that structure
 * is the reviewers' points, not the manuscript's sections.
 */
export function RoundOutline({ roundId }: { roundId: string }): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const saveBump = useProjectStore((s) => s.saveBump)
  // Both panes' selections, so a split workspace can be read off the outline:
  // one point is where you are typing, the other is what you are answering
  // against, and an outline that marked only one of them would send you
  // hunting for the second in the pane.
  const points = useRoundFocusStore((s) => s.points)
  const activePane = useRoundFocusStore((s) => s.activePane)
  const split = useRoundFocusStore((s) => s.split)
  const activeRound = useRoundFocusStore((s) => s.roundId)
  const selected = points[activePane]
  const paired = split ? points[activePane === 'a' ? 'b' : 'a'] : null
  // The tab's header filter narrows this list too — it is the same list of
  // points, and an outline that ignored it would offer points the pane
  // refuses to show.
  const filter = useRoundFocusStore((s) => s.filter)

  const [round, setRound] = useState<Round | null>(null)
  const [reports, setReports] = useState<ReviewerReport[]>([])
  const [open, setOpen] = useState(true)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Scrolling the pane in continuous mode moves the selection here; the
  // indicator has to follow it, or it marks a point that is off-screen.
  useEffect(() => {
    if (selected === null || activeRound !== roundId) return
    const el = listRef.current?.querySelector(`[data-outline-point="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected, activeRound, roundId])

  const load = useCallback(async () => {
    if (rootDir === null) return
    try {
      const res = await window.suna.invoke('round:read', { dir: rootDir, roundId })
      setRound(res.round)
      setReports(res.reports)
    } catch {
      setRound(null)
      setReports([])
    }
  }, [rootDir, roundId])

  useEffect(() => {
    void load()
  }, [load, saveBump])

  if (round === null) return <div className="docout" />
  const total = reports.reduce((n, r) => n + r.points.length, 0)
  if (total === 0) {
    return (
      <div className="docout">
        <p className="docout__empty">No reviewer comments imported into this round yet.</p>
      </div>
    )
  }

  const progress = roundProgress(round, reports)

  return (
    <div className="docout">
      <button
        className="rvout__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? 'Collapse the points' : 'Expand the points'}
      >
        <span className={`docs__twisty${open ? ' is-open' : ''}`} aria-hidden="true">
          ›
        </span>
        <span className="rvout__title">{round.label}</span>
        <span className="rvout__count">
          {progress.addressed}/{progress.total}
        </span>
      </button>
      {open &&
        reports.map((report) => {
          const rp = progress.byReviewer.find((b) => b.index === report.index)
          const points = report.points.filter((p) =>
            matchesPointFilter(pointStateFor(round, p.id).status, filter)
          )
          if (points.length === 0) return null
          return (
            <section key={report.index} className="rvout__rev">
            <h4>
              Reviewer {report.index}
              <span className="rvout__count">
                {rp?.addressed ?? 0}/{rp?.total ?? 0}
              </span>
            </h4>
            <ul className="docout__list">
              {points.map((p) => {
                const st = pointStateFor(round, p.id)
                return (
                  <li key={p.id}>
                    <button
                      data-outline-point={p.id}
                      className={`rvout__pt is-${st.status}${
                        selected === p.id && activeRound === roundId ? ' is-active' : ''
                      }${paired === p.id && activeRound === roundId ? ' is-paired' : ''}`}
                      onClick={() => {
                        if (rootDir !== null) openRoundTab(rootDir, roundId)
                        // No pane argument: a click lands in whichever pane
                        // was last touched, which is the pane the user is
                        // looking at. Naming one here would make the outline
                        // overrule that.
                        focusRoundPoint(roundId, p.id)
                      }}
                      title={p.verbatim}
                    >
                      <span className="rvout__pt-id">
                        {report.index}.{p.pointIndex}
                      </span>
                      {/* Which pane holds this point — only worth saying when
                          there are two of them to tell apart. */}
                      {split && activeRound === roundId && (selected === p.id || paired === p.id) && (
                        <span className="rvout__pt-pane">
                          {selected === p.id ? activePane.toUpperCase() : activePane === 'a' ? 'B' : 'A'}
                        </span>
                      )}
                      <span className="rvout__pt-text">
                        {p.verbatim.replace(/\s+/g, ' ').trim()}
                      </span>
                      {isAddressed(st.status) && <span className="rvout__pt-tick">✓</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
            </section>
          )
        })}
    </div>
  )
}
