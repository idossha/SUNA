import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { PEER_REVIEW_FILE } from '@suna/core'
import type { PointStatus, ReviewPointRecord, ReviewerReport, Round } from '@suna/core'
import { isAddressed, pointStateFor, roundProgress } from '@suna/core'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { openReviewImportTab } from '../state/dock'
import { refreshDocuments } from '../state/documents'
import { markRoundPoint, useRoundFocusStore } from '../state/roundFocus'
import { ReplyAssistant } from './ReplyAssistant'
import { pointReplyContext, type ReplyContextSource } from './replyContext'
import './documents.css'

/**
 * The response workspace (document-kinds-ux.md §C).
 *
 * One pane. The list of points is the sidebar's outline — the tab carried its
 * own copy of it, and two identical lists side by side is one list and a
 * distraction. The reviewer's text
 * is read-only, with no edit affordance anywhere, because editing a
 * reviewer's words is misconduct and the UI should make it impossible rather
 * than merely discouraged. The reply beneath it is yours, and is the only
 * editable thing on the screen.
 *
 * Two modes, because answering 84 points is two different jobs. **Focus** is
 * one point at a time — the mode for actually writing a reply, with nothing
 * else on screen. **Continuous** is every point in one scroll, like the
 * manuscript, which is the only way to read what you have written as the
 * document a reviewer will read it as.
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
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mode = useRoundFocusStore((st) => st.mode)
  const setMode = useRoundFocusStore((st) => st.setMode)
  const focusedRound = useRoundFocusStore((st) => st.roundId)
  const focusedPoint = useRoundFocusStore((st) => st.pointId)
  const focusNonce = useRoundFocusStore((st) => st.nonce)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // The sidebar outline and this tab share one selection. In continuous mode
  // "selecting" a point means scrolling to it, which is what the outline does
  // on the manuscript too.
  //
  // Only an EXPLICIT pick scrolls, and the nonce is how we tell one apart from
  // scroll-spy writing the same field. Reacting to `focusedPoint` instead made
  // the pane jitter: the spy marked a point, the effect scrolled to it, the
  // scroll re-marked, and the wheel fought a smooth-scroll animation the whole
  // way down.
  const lastNonce = useRef(0)
  useEffect(() => {
    if (focusNonce === lastNonce.current) return
    lastNonce.current = focusNonce
    if (focusedRound !== roundId || focusedPoint === null) return
    setSelected(focusedPoint)
    scrollRef.current
      ?.querySelector(`[data-point="${focusedPoint}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [focusNonce, focusedRound, focusedPoint, roundId])

  // Selection without scrolling — the spy's writes still move the highlight.
  useEffect(() => {
    if (focusedRound === roundId && focusedPoint !== null) setSelected(focusedPoint)
  }, [focusedRound, focusedPoint, roundId])

  // Scroll-spy for continuous mode: the highest card that is FULLY on screen.
  // "Fully" is what makes it stable — a card entering by one pixel at the
  // bottom, or leaving by one at the top, no longer takes the indicator.
  useEffect(() => {
    const root = scrollRef.current
    if (root === null || mode !== 'scroll') return

    let frame = 0
    const measure = (): void => {
      frame = 0
      const box = root.getBoundingClientRect()
      let best: string | null = null
      let bestTop = Infinity
      // Fallback for a card taller than the pane, which is never fully
      // visible: the one covering the top edge is what you are reading.
      let covering: string | null = null
      for (const el of root.querySelectorAll<HTMLElement>('[data-point]')) {
        const id = el.dataset['point']
        if (id === undefined) continue
        const r = el.getBoundingClientRect()
        if (r.top <= box.top + 1 && r.bottom > box.top + 1) covering = id
        if (r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.top < bestTop) {
          best = id
          bestTop = r.top
        }
      }
      const winner = best ?? covering
      if (winner !== null) markRoundPoint(roundId, winner)
    }

    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    measure()
    return () => {
      root.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [mode, roundId, reports])

  const load = useCallback(async () => {
    try {
      const res = await window.suna.invoke('round:read', { dir: rootDir, roundId })
      setRound(res.round)
      setReports(res.reports)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [rootDir, roundId])

  useEffect(() => {
    void load()
  }, [load])

  // context/PEER-REVIEW.md — this group's standing instructions for answering
  // referees. Read once per tab and passed into every prompt verbatim; a
  // missing file is the normal case for an older project and simply means
  // the agent is told there are no house conventions.
  const [guidelines, setGuidelines] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    window.suna
      .invoke('fs:read-text', { path: `${rootDir}/context/${PEER_REVIEW_FILE}` })
      .then(({ content }) => {
        if (live) setGuidelines(content.trim() === '' ? null : content)
      })
      .catch(() => {
        // No file: an older project, or one whose heal could not write. Both
        // mean the same thing here — nothing has been said about how this
        // group answers reviewers.
        if (live) setGuidelines(null)
      })
    return () => {
      live = false
    }
  }, [rootDir])



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
      refreshDocuments()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const setReply = async (pointId: string, reply: string): Promise<void> => {
    if (round === null) return
    const current = pointStateFor(round, pointId)
    if (current.reply === reply) return
    try {
      const res = await window.suna.invoke('review:set-point', {
        dir: rootDir,
        roundId,
        pointId,
        // Writing the first words of a reply IS drafting it. Making the author
        // also click "Drafted" is a second action for a fact the app can see,
        // and the status people forget to set is the one that makes the
        // progress count lie.
        status:
          current.status === 'unaddressed' && reply.trim() !== '' ? 'drafted' : current.status,
        reply
      })
      setRound(res.round)
      refreshDocuments()
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
        <div className="round__modes" role="group" aria-label="View">
          <button
            className={`round__mode${mode === 'focus' ? ' is-on' : ''}`}
            onClick={() => setMode('focus')}
            title="One point at a time"
          >
            Focus
          </button>
          <button
            className={`round__mode${mode === 'scroll' ? ' is-on' : ''}`}
            onClick={() => setMode('scroll')}
            title="Every point in one scroll, like the manuscript"
          >
            Continuous
          </button>
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
        {/* ---- the point, and what you do about it ------------------------ */}
        <section className="round__detail" ref={scrollRef}>
          {mode === 'scroll' ? (
            reports.map((report) => (
              <div key={report.index} className="round__scroll-rev">
                <h3 className="round__scroll-head">{report.label}</h3>
                {report.points.map((p) => (
                  <PointCard
                    key={p.id}
                    point={p}
                    state={pointStateFor(round, p.id)}
                    selected={selected === p.id}
                    onSelect={() => setSelected(p.id)}
                    onStatus={(st) => void setStatus(p.id, st)}
                    onReply={(t) => void setReply(p.id, t)}
                    source={{ rootDir, round, reports, report, guidelines, onGuidelinesApproved: setGuidelines }}
                  />
                ))}
              </div>
            ))
          ) : activePoint === null || activeState === null ? (
            <p className="round__hint">Choose a point in the outline, or switch to Continuous.</p>
          ) : (
            <PointCard
              point={activePoint}
              state={activeState}
              selected
              onSelect={() => undefined}
              onStatus={(st) => void setStatus(activePoint.id, st)}
              onReply={(t) => void setReply(activePoint.id, t)}
              source={{
                rootDir,
                round,
                reports,
                report:
                  reports.find((r) => r.points.some((p) => p.id === activePoint.id)) ?? reports[0],
                guidelines,
                onGuidelinesApproved: setGuidelines
              }}
            />
          )}
          {error !== null && <p className="sheet__error">{error}</p>}
        </section>
      </div>

    </div>
  )
}

/**
 * One reviewer point and everything you do about it. Both modes render this —
 * focus shows one, continuous shows all of them — so a reply written in one
 * mode is the same reply, in the same box, in the other.
 */
function PointCard({
  point,
  state,
  selected,
  onSelect,
  onStatus,
  onReply,
  source
}: {
  point: ReviewPointRecord
  state: ReturnType<typeof pointStateFor>
  selected: boolean
  onSelect: () => void
  onStatus: (status: PointStatus) => void
  onReply: (reply: string) => void
  /** Everything the AI assistant needs to build this point's prompt. */
  source: ReplyContextSource
}): JSX.Element {
  // The textarea is uncontrolled and commits on blur: a round-trip to disk per
  // keystroke would fight the caret, and the reply is prose — people type
  // paragraphs into it, not a field value.
  const [draft, setDraft] = useState(state.reply)
  useEffect(() => {
    setDraft(state.reply)
  }, [point.id, state.reply])

  return (
    <article
      className={`round__card${selected ? ' is-selected' : ''}`}
      data-point={point.id}
      onFocus={onSelect}
      onClick={onSelect}
    >
      <div className="round__verbatim">
        <header>
          Reviewer {point.reviewerIndex}, point {point.pointIndex}
          {point.section !== null && ` · ${point.section}`}
          <span className="round__locked" title="A reviewer's words are never editable">
            verbatim
          </span>
        </header>
        {/*
          Deliberately not a textarea, not a disabled input, not a
          contentEditable with a guard — there is no edit control here at all.
          The only operations on a reviewer's text are split and merge, at
          import, and both re-derive from the source.
        */}
        <blockquote>{point.verbatim}</blockquote>
      </div>

      <div className="round__reply">
        <label htmlFor={`reply-${point.id}`}>Our reply</label>
        <textarea
          id={`reply-${point.id}`}
          className="round__reply-box"
          value={draft}
          placeholder="Answer this point. Markdown; @fig:, @tab: and citation keys resolve at export."
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onReply(draft)}
          onKeyDown={(e) => {
            // ⌘/Ctrl+Enter commits without leaving the box — the shortcut
            // people already have in every reply field they use.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onReply(draft)
            }
            if (e.key === 'Escape') {
              setDraft(state.reply)
              e.currentTarget.blur()
            }
          }}
          rows={draft.split('\n').length + 4}
        />
      </div>

      {/*
        One footer row under the box: what you decided on the left, what the
        AI can do about it on the right. They are the two things you do to a
        reply and they belong on the same line — a full-width AI strip above
        the statuses read as part of the reply itself.

        A grid rather than a flex row because ReplyAssistant is more than its
        button bar: its busy strip and its proposal must span the whole width
        underneath both groups, which they do via `display: contents` on the
        assistant's own root (documents.css).
      */}
      <div className="round__foot">
        <div className="round__status">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              className={`round__st is-${s.id}${state.status === s.id ? ' is-on' : ''}`}
              title={s.hint}
              onClick={() => onStatus(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <ReplyAssistant
          context={pointReplyContext(source, point)}
          currentReply={draft}
          onAccept={(text) => {
            setDraft(text)
            onReply(text)
          }}
          onGuidelinesApproved={source.onGuidelinesApproved}
        />
      </div>
    </article>
  )
}
