import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { PEER_REVIEW_FILE } from '@suna/core'
import type { PointStatus, ReviewPointRecord, ReviewerReport, Round } from '@suna/core'
import {
  baselineVersionFor,
  compareRefId,
  isAddressed,
  pointStateFor,
  roundProgress,
  stageLabel,
  unaddressedPoints,
  versionsNewestFirst,
  type LoggedVersion
} from '@suna/core'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { openCompareInSide, openReviewImportTab } from '../state/dock'
import { refreshDocuments } from '../state/documents'
import { roundChangedOnDisk } from '../state/roundSync'
import {
  markRoundPoint,
  matchesPointFilter,
  useRoundFocusStore,
  type PointFilter,
  type RoundMode,
  type RoundPane
} from '../state/roundFocus'
import { useRoundTick } from '../state/roundSync'
import { useResolved } from '../state/settings'
import { useUiStore } from '../state/ui'
import { notifyExported } from '../export/exportToast'
import { NewDocumentMenu } from './NewDocumentMenu'
import { ReplyAssistant } from './ReplyAssistant'
import { ReplyEditor, ReplyQuickBar, type ReplyEditorHandle } from './ReplyEditor'
import { ResponseSettingsPopover } from './ResponseSettingsPopover'
import { GearIcon } from '../editor/GearIcon'
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
 * **Compare** puts a second pane on the same round beside the first. Two
 * reviewers routinely raise the same objection in different words, and the
 * reply has to answer both without contradicting itself — which you cannot
 * check by scrolling back and forth, because the point you are answering
 * leaves the screen. Exactly two panes: the cap is in `RoundPane` rather
 * than a length check, and a third column of reply cards does not fit a
 * laptop anyway. Both panes are the same round, share the header's mode and
 * filter, and hold their own selection; whichever you last touched is the
 * one the sidebar outline drives.
 *
 * The status filter in the header narrows both this pane and the sidebar
 * outline, because they are one list read twice; a pane that showed only the
 * unaddressed points beside an outline that still listed all 84 of them would
 * be two answers to the same question.
 *
 * `rebutted` sits beside `done` as a first-class outcome. Every real response
 * letter disagrees with something, and a tool that models only compliance
 * quietly pressures authors into conceding points they should defend.
 *
 * The gear in the header holds the two things about a response that are house
 * style rather than structure: whether the three voices are coloured, and
 * whether the reply box types the conventions for you. Both are resolved
 * settings, so a project can fix them for every co-author, and both reach the
 * export — the workspace is a preview of the file, not a different picture of
 * it (ResponseSettingsPopover, reply-markup.ts).
 */

const STATUSES: { id: PointStatus; label: string; hint: string }[] = [
  { id: 'unaddressed', label: 'Unaddressed', hint: 'Not yet answered' },
  { id: 'drafted', label: 'Drafted', hint: 'A reply exists but is not finished' },
  { id: 'done', label: 'Done', hint: 'Answered, and the manuscript changed if it needed to' }
]

/**
 * The header's status filter. `All` first, because it is the state the
 * workspace opens in and the one you return to.
 */
const FILTERS: { id: PointFilter; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Every point in the round' },
  { id: 'unaddressed', label: 'Unaddressed', hint: 'Points with no reply yet' },
  { id: 'drafted', label: 'Drafted', hint: 'Replies written but not finished' },
  { id: 'done', label: 'Done', hint: 'Answered — done or rebutted' }
]

/**
 * `rebutted` is not offered, by request — but it is not gone.
 *
 * It remains a value of `PointStatusSchema`, it still counts as addressed,
 * and a point that already carries it still shows its pill so the state is
 * visible and can be changed. Hiding a status the DATA can hold would leave a
 * point the author could neither see the truth about nor move off, which is
 * worse than the extra button.
 */
const REBUTTED: { id: PointStatus; label: string; hint: string } = {
  id: 'rebutted',
  label: 'Rebutted',
  hint: 'We disagree, and the reply says why'
}

/** The pills this card shows: the three, plus `rebutted` where it is set. */
function statusesFor(current: PointStatus): { id: PointStatus; label: string; hint: string }[] {
  return current === 'rebutted' ? [...STATUSES, REBUTTED] : STATUSES
}

export function RoundTab({ params }: DockPanelProps): JSX.Element {
  const rootDir = String(params?.['rootDir'] ?? '')
  const roundId = String(params?.['roundId'] ?? '')

  const [round, setRound] = useState<Round | null>(null)
  const [reports, setReports] = useState<ReviewerReport[]>([])
  const [error, setError] = useState<string | null>(null)

  const mode = useRoundFocusStore((st) => st.mode)
  const setMode = useRoundFocusStore((st) => st.setMode)
  const filter = useRoundFocusStore((st) => st.filter)
  const setFilter = useRoundFocusStore((st) => st.setFilter)
  const split = useRoundFocusStore((st) => st.split)
  const setSplit = useRoundFocusStore((st) => st.setSplit)

  const { value: colorRoles } = useResolved('response.colorRoles')
  const { value: quickInsert } = useResolved('response.quickInsert')
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  // Re-read when something outside this tab wrote to the round — a quote
  // inserted from the comparison view is the case that exists today.
  const tick = useRoundTick(roundId)
  useEffect(() => {
    void load()
  }, [load, tick])

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

  // How many points each filter would leave — on the buttons, so choosing one
  // is never a guess about whether anything is behind it.
  const counts = { all: 0, unaddressed: 0, drafted: 0, done: 0 }
  for (const report of reports) {
    for (const p of report.points) {
      const { status } = pointStateFor(round, p.id)
      counts.all += 1
      for (const f of ['unaddressed', 'drafted', 'done'] as const) {
        if (matchesPointFilter(status, f)) counts[f] += 1
      }
    }
  }

  // Reviewers with nothing left after the filter drop out with their heading:
  // an empty "Reviewer 2" section reads as a reviewer who wrote nothing.
  const shown = reports
    .map((r) => ({
      report: r,
      points: r.points.filter((p) => matchesPointFilter(pointStateFor(round, p.id).status, filter))
    }))
    .filter((r) => r.points.length > 0)

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
        <div className="round__tools">
          <div className="round__filter" role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={`round__fbtn${filter === f.id ? ' is-on' : ''}`}
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                title={f.hint}
              >
                {f.label}
                <span className="round__fcount">{counts[f.id]}</span>
              </button>
            ))}
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
          {/*
            One button, both directions — the same control turns the second
            pane on and off, and it sits with the mode switch because "how
            many panes" and "how much of the round is in one" are the same
            question about how you are reading. Pane B's own × closes it too,
            so the way out is wherever you happen to be looking.
          */}
          <div className="round__modes" role="group" aria-label="Compare">
            <button
              className={`round__mode${split ? ' is-on' : ''}`}
              onClick={() => setSplit(!split)}
              aria-pressed={split}
              title={
                split
                  ? 'Back to one pane'
                  : 'Open a second pane on this round — read two points side by side'
              }
            >
              <span aria-hidden="true">⧉</span> Compare
            </button>
          </div>
          <RoundCompareButton rootDir={rootDir} round={round} />
          {progress !== null && (
            <div className="round__progress">
              <strong>
                {progress.addressed} of {progress.total}
              </strong>{' '}
              points addressed
            </div>
          )}
          <ResponseExportButton
            rootDir={rootDir}
            roundId={roundId}
            outputName={`response-${roundId}`}
            colorRoles={colorRoles}
            unaddressed={unaddressedPoints(round, reports).map(
              (p) => `Reviewer ${p.reviewerIndex}, point ${p.pointIndex}`
            )}
          />
          <span className="round__settings-wrap">
            <button
              className={`round__gear${settingsOpen ? ' is-on' : ''}`}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Response settings"
              aria-expanded={settingsOpen}
              title="How this response is written and coloured"
            >
              <GearIcon />
            </button>
            {settingsOpen && <ResponseSettingsPopover onClose={() => setSettingsOpen(false)} />}
          </span>
        </div>
      </header>

      {/* ---- the point, and what you do about it -------------------------- */}
      <div className={`round__cols${split ? ' is-split' : ''}`}>
        <RoundPaneView
          pane="a"
          split={split}
          rootDir={rootDir}
          roundId={roundId}
          round={round}
          reports={reports}
          shown={shown}
          mode={mode}
          filter={filter}
          allCount={counts.all}
          colorRoles={colorRoles}
          quickInsert={quickInsert}
          guidelines={guidelines}
          onGuidelinesApproved={setGuidelines}
          onStatus={(id, st) => void setStatus(id, st)}
          onReply={(id, t) => void setReply(id, t)}
          onFilter={setFilter}
          onClose={() => setSplit(false)}
        />
        {split && (
          <RoundPaneView
            pane="b"
            split
            rootDir={rootDir}
            roundId={roundId}
            round={round}
            reports={reports}
            shown={shown}
            mode={mode}
            filter={filter}
            allCount={counts.all}
            colorRoles={colorRoles}
            quickInsert={quickInsert}
            guidelines={guidelines}
            onGuidelinesApproved={setGuidelines}
            onStatus={(id, st) => void setStatus(id, st)}
            onReply={(id, t) => void setReply(id, t)}
            onFilter={setFilter}
            onClose={() => setSplit(false)}
          />
        )}
      </div>

      {/* Below both panes, not inside one: a write that failed failed for the
          round, and printing it twice would read as two failures. */}
      {error !== null && <p className="sheet__error round__error">{error}</p>}
    </div>
  )
}

/** One reviewer's points and the replies to them — the round tab renders one or two. */
type ShownReports = { report: ReviewerReport; points: ReviewPointRecord[] }[]

/**
 * One pane of the round workspace.
 *
 * Everything per-pane lives here — the selection, the scroller, the
 * scroll-spy — because those are exactly the things the two panes must not
 * share. What they DO share (which round, which mode, which filter, the
 * reply text itself) stays in the tab above, so a reply typed in one pane is
 * the same reply the other pane is showing.
 */
function RoundPaneView({
  pane,
  split,
  rootDir,
  roundId,
  round,
  reports,
  shown,
  mode,
  filter,
  allCount,
  colorRoles,
  quickInsert,
  guidelines,
  onGuidelinesApproved,
  onStatus,
  onReply,
  onFilter,
  onClose
}: {
  pane: RoundPane
  /** Is the second pane open? Drives the pane header, which is noise on its own. */
  split: boolean
  rootDir: string
  roundId: string
  round: Round
  reports: readonly ReviewerReport[]
  /** The filtered points, grouped by reviewer — computed once for both panes. */
  shown: ShownReports
  mode: RoundMode
  filter: PointFilter
  allCount: number
  colorRoles: boolean
  quickInsert: boolean
  guidelines: string | null
  onGuidelinesApproved: (text: string) => void
  onStatus: (pointId: string, status: PointStatus) => void
  onReply: (pointId: string, reply: string) => void
  onFilter: (filter: PointFilter) => void
  onClose: () => void
}): JSX.Element {
  const focusedRound = useRoundFocusStore((st) => st.roundId)
  const panePoint = useRoundFocusStore((st) => st.points[pane])
  const focusNonce = useRoundFocusStore((st) => st.nonces[pane])
  const activePane = useRoundFocusStore((st) => st.activePane)
  const setActivePane = useRoundFocusStore((st) => st.setActivePane)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // A selection from a different round is not a selection here.
  const selected = focusedRound === roundId ? panePoint : null

  // The sidebar outline and this pane share one selection. In continuous mode
  // "selecting" a point means scrolling to it, which is what the outline does
  // on the manuscript too.
  //
  // Only an EXPLICIT pick scrolls, and the nonce is how we tell one apart from
  // scroll-spy writing the same field. Reacting to the point id instead made
  // the pane jitter: the spy marked a point, the effect scrolled to it, the
  // scroll re-marked, and the wheel fought a smooth-scroll animation the whole
  // way down. The nonce is per pane, so a pick aimed at one pane leaves the
  // other exactly where it was — which is the entire reason to have two.
  const lastNonce = useRef(0)
  useEffect(() => {
    if (focusNonce === lastNonce.current) return
    lastNonce.current = focusNonce
    if (selected === null) return
    // Synchronously, in this effect, and NOT deferred to a frame: the
    // scroll-spy below takes its first measurement during its own setup, and
    // a scroll left waiting on rAF loses its target to that measurement
    // before it ever runs.
    scrollRef.current
      ?.querySelector(`[data-point="${selected}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [focusNonce, selected])

  // Scroll-spy for continuous mode: the highest card that is FULLY on screen.
  // "Fully" is what makes it stable — a card entering by one pixel at the
  // bottom, or leaving by one at the top, no longer takes the indicator.
  useEffect(() => {
    const root = scrollRef.current
    if (root === null || mode !== 'scroll') return

    let frame = 0
    const measure = (): void => {
      frame = 0
      // An unsized pane — the dock has not laid the panel out yet — measures
      // every card as a zero-height box at the origin, and every one of them
      // then counts as "fully visible", so the spy would report point 1 and
      // overwrite the point this pane is being restored to.
      if (root.clientHeight === 0) return
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
      if (winner !== null) markRoundPoint(roundId, winner, pane)
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
  }, [mode, roundId, pane, reports])

  const activePoint =
    selected === null
      ? null
      : (reports.flatMap((r) => r.points).find((p) => p.id === selected) ?? null)
  const activeState = activePoint === null ? null : pointStateFor(round, activePoint.id)
  const isActive = !split || activePane === pane

  const sourceFor = (report: ReviewerReport | undefined): ReplyContextSource => ({
    rootDir,
    round,
    reports,
    report: report ?? reports[0],
    guidelines,
    onGuidelinesApproved
  })

  return (
    <section
      className={`round__pane${isActive ? ' is-active' : ''}`}
      // Touching a pane makes it the one the outline drives. Capture, because
      // the click that matters is usually on a button or inside the reply
      // editor, and those stop it before it reaches here.
      onPointerDownCapture={() => setActivePane(pane)}
      onFocusCapture={() => setActivePane(pane)}
      aria-label={split ? `Pane ${pane.toUpperCase()}` : undefined}
    >
      {/*
        The pane header exists only in split view: with one pane there is
        nothing to tell apart, and a strip saying "A" above the only column
        on screen is a label for a choice nobody made.
      */}
      {split && (
        <header className="round__pane-head">
          <span className="round__pane-tag">{pane.toUpperCase()}</span>
          <span className="round__pane-where">
            {activePoint === null
              ? 'No point chosen'
              : `Reviewer ${activePoint.reviewerIndex}, point ${activePoint.pointIndex}`}
          </span>
          {pane === 'b' && (
            <button
              className="round__pane-close"
              onClick={onClose}
              title="Close this pane"
              aria-label="Close the second pane"
            >
              ×
            </button>
          )}
        </header>
      )}

      <div className="round__detail" ref={scrollRef}>
        {mode === 'scroll' ? (
          shown.length === 0 ? (
            <p className="round__hint">
              No {FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} points.{' '}
              <button className="round__link" onClick={() => onFilter('all')}>
                Show all {allCount}
              </button>
            </p>
          ) : (
            shown.map(({ report, points }) => (
              <div key={report.index} className="round__scroll-rev">
                <h3 className="round__scroll-head">{report.label}</h3>
                {points.map((p) => (
                  <PointCard
                    key={p.id}
                    point={p}
                    state={pointStateFor(round, p.id)}
                    selected={selected === p.id}
                    onSelect={() => markRoundPoint(roundId, p.id, pane)}
                    onStatus={(st) => onStatus(p.id, st)}
                    onReply={(t) => onReply(p.id, t)}
                    colorRoles={colorRoles}
                    quickInsert={quickInsert}
                    reports={reports}
                    source={sourceFor(report)}
                  />
                ))}
              </div>
            ))
          )
        ) : activePoint === null || activeState === null ? (
          <p className="round__hint">
            Choose a point in the outline{split ? ' for this pane' : ''}, or switch to Continuous.
          </p>
        ) : (
          <PointCard
            point={activePoint}
            state={activeState}
            selected
            onSelect={() => undefined}
            onStatus={(st) => onStatus(activePoint.id, st)}
            onReply={(t) => onReply(activePoint.id, t)}
            colorRoles={colorRoles}
            quickInsert={quickInsert}
            reports={reports}
            source={sourceFor(reports.find((r) => r.points.some((p) => p.id === activePoint.id)))}
          />
        )}
      </div>
    </section>
  )
}

/**
 * "Changes since v1.3" — the comparison this round is written against
 * (feature-plan-14 §3).
 *
 * A round's whole job is to answer reviewers who read ONE particular text, so
 * the workspace names that text and opens the comparison against it beside
 * itself. Split rather than a new full tab because the three things you need
 * while answering a point — the point, your reply, and what you changed for
 * it — have to be on screen together; the tab is still one ⌘-click away if
 * the diff needs the whole window.
 *
 * The caret sets which version the reviewers read. It is inferred from the
 * dates until somebody says otherwise (`baselineVersionFor`), and the menu is
 * where they say otherwise — the inference is a good guess, not a fact, and a
 * round whose baseline is wrong quotes the wrong "before" into every reply.
 */
function RoundCompareButton({ rootDir, round }: { rootDir: string; round: Round }): JSX.Element {
  const [versions, setVersions] = useState<LoggedVersion[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const caretRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const { versions: list } = await window.suna.invoke('version:list', { dir: rootDir })
      setVersions(list)
    } catch {
      setVersions([])
    }
  }, [rootDir])

  useEffect(() => {
    void load()
  }, [load])

  const baseline = baselineVersionFor(round, versions)
  const inferred = round.baselineVersionId === null && baseline !== null

  const setBaseline = async (versionId: string | null): Promise<void> => {
    setSaving(true)
    try {
      await window.suna.invoke('round:set-baseline', { dir: rootDir, roundId: round.id, versionId })
      roundChangedOnDisk(round.id)
    } catch (err) {
      useUiStore
        .getState()
        .setStatusNote(
          `Could not record the version — ${err instanceof Error ? err.message : String(err)}`
        )
    } finally {
      setSaving(false)
      setMenuOpen(false)
    }
  }

  const open = (): void => {
    if (baseline === null) {
      setMenuOpen(true)
      return
    }
    openCompareInSide(rootDir, compareRefId({ kind: 'round', roundId: round.id }), 'working')
  }

  return (
    <span className="round__cmp-wrap">
      <button
        className="round__cmp"
        onClick={open}
        disabled={rootDir === ''}
        title={
          baseline === null
            ? 'No version is recorded for this round — choose which one the reviewers read'
            : `Show what changed since ${baseline.id}, beside this round`
        }
      >
        <span aria-hidden="true">⇄</span>{' '}
        {baseline === null ? 'Set the version they read…' : `Changes since ${baseline.id}`}
      </button>
      <button
        ref={caretRef}
        className="round__cmp-caret"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-label="Which version the reviewers read"
        title={
          baseline === null
            ? 'Which version did these reviewers read?'
            : inferred
              ? `Inferred from the dates: ${baseline.id}. Click to set it explicitly.`
              : `Recorded: ${baseline.id}`
        }
        disabled={saving}
      >
        ▾
      </button>
      {menuOpen && caretRef.current !== null && (
        <NewDocumentMenu
          anchorEl={caretRef.current}
          onClose={() => setMenuOpen(false)}
          items={[
            ...versionsNewestFirst(versions).map((v) => ({
              label: `${v.id} — ${stageLabel(v.stage)}${baseline?.id === v.id ? ' ✓' : ''}`,
              onSelect: () => void setBaseline(v.id)
            })),
            ...(round.baselineVersionId === null
              ? []
              : [{ label: 'Clear — infer from the dates', onSelect: () => void setBaseline(null) }]),
            ...(versions.length === 0
              ? [
                  {
                    label: 'No versions logged yet — log one from the manuscript',
                    onSelect: () => setMenuOpen(false)
                  }
                ]
              : [])
          ]}
        />
      )}
    </span>
  )
}

/**
 * The round's own Export — the letter tab's button, in the letter tab's
 * shape, wired to the response exporter (main/services/export-response.ts).
 *
 * The response document is derived from this workspace rather than written
 * beside it: the reviewer's words come out of the immutable report, the reply
 * out of the point state you typed it into. So there is nothing to keep in
 * sync and nothing to ask about beyond which file type.
 *
 * An unaddressed point is named, not counted, and it stops the export once —
 * "Reviewer 2, point 3" is actionable in a way "3 problems" is not, and a
 * response circulated to co-authors mid-revision is a legitimate thing to
 * want anyway.
 */
function ResponseExportButton({
  rootDir,
  roundId,
  outputName,
  colorRoles,
  unaddressed
}: {
  rootDir: string
  roundId: string
  outputName: string
  /**
   * Paint the three voices in the exported file. Resolved here rather than in
   * main because the renderer is the side that holds the two-level settings
   * hierarchy — and because it is what makes the export match the workspace
   * the author was just looking at.
   */
  colorRoles: boolean
  /** Points still neither done nor rebutted, labelled by reviewer and number. */
  unaddressed: readonly string[]
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // The format picked while points are still unaddressed — held until the
  // author says whether to export the response as it stands.
  const [confirming, setConfirming] = useState<'pdf' | 'docx' | 'html' | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const run = async (format: 'pdf' | 'docx' | 'html', acknowledge: boolean): Promise<void> => {
    setConfirming(null)
    setBusy(true)
    try {
      const { path } = await window.suna.invoke('export:response', {
        dir: rootDir,
        roundId,
        format,
        outputName,
        acknowledgeUnaddressed: acknowledge,
        colorRoles
      })
      notifyExported(
        path,
        acknowledge && unaddressed.length > 0
          ? `${unaddressed.length} point${unaddressed.length === 1 ? '' : 's'} still unaddressed`
          : undefined
      )
    } catch (err) {
      useUiStore
        .getState()
        .setStatusNote(
          `Response export failed — ${err instanceof Error ? err.message : String(err)}`
        )
    } finally {
      setBusy(false)
    }
  }

  const pick = (format: 'pdf' | 'docx' | 'html'): void => {
    if (unaddressed.length > 0) {
      setConfirming(format)
      return
    }
    void run(format, false)
  }

  return (
    <span className="round__export-wrap">
      <button
        ref={btnRef}
        className="round__export"
        onClick={() => setOpen((v) => !v)}
        disabled={busy || rootDir === ''}
        title="Export the response to reviewers as PDF, Word or a web page"
      >
        {busy ? 'Exporting…' : 'Export…'}
      </button>
      {open && confirming === null && btnRef.current !== null && (
        <NewDocumentMenu
          anchorEl={btnRef.current}
          onClose={() => setOpen(false)}
          items={[
            { label: 'PDF', onSelect: () => pick('pdf') },
            { label: 'Word (.docx)', onSelect: () => pick('docx') },
            { label: 'Web page (.html)', onSelect: () => pick('html') }
          ]}
        />
      )}
      {confirming !== null && (
        <ResponseExportConfirm
          unaddressed={unaddressed}
          onCancel={() => {
            setConfirming(null)
            setOpen(false)
          }}
          onConfirm={() => {
            setOpen(false)
            void run(confirming, true)
          }}
        />
      )}
    </span>
  )
}

/**
 * The acknowledgement.
 *
 * Every unaddressed point by name, because that is the check that catches the
 * reply nobody noticed was missing (document-kinds-ux.md §C.3). The exported
 * response quotes those points and simply says nothing under them — SUNA does
 * not answer a reviewer for you.
 */
function ResponseExportConfirm({
  unaddressed,
  onCancel,
  onConfirm
}: {
  unaddressed: readonly string[]
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  const shown = unaddressed.slice(0, 8)
  return (
    <>
      <div className="docs__menu-scrim" onClick={onCancel} role="presentation" />
      <div className="lxconfirm" role="dialog" aria-label="Export with unaddressed points">
        <p className="lxconfirm__lead">
          {unaddressed.length} point{unaddressed.length === 1 ? '' : 's'} still unaddressed:
        </p>
        <p className="lxconfirm__ids">
          {shown.join('; ')}
          {unaddressed.length > shown.length ? `; +${unaddressed.length - shown.length} more` : ''}
        </p>
        <p className="lxconfirm__note">
          The exported response will quote {unaddressed.length === 1 ? 'it' : 'them'} with no reply
          underneath — SUNA never answers a reviewer for you.
        </p>
        <div className="lxconfirm__row">
          <button className="lxconfirm__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="lxconfirm__go" onClick={onConfirm}>
            Export anyway
          </button>
        </div>
      </div>
    </>
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
  colorRoles,
  quickInsert,
  reports,
  source
}: {
  point: ReviewPointRecord
  state: ReturnType<typeof pointStateFor>
  selected: boolean
  onSelect: () => void
  onStatus: (status: PointStatus) => void
  onReply: (reply: string) => void
  colorRoles: boolean
  quickInsert: boolean
  /** Every report in the round — the cross-reference picker's source. */
  reports: readonly ReviewerReport[]
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

  // State rather than a ref: the quick-insert bar renders beside the statuses
  // and needs a re-render once the editor exists to enable its buttons.
  const [editor, setEditor] = useState<ReplyEditorHandle | null>(null)

  return (
    <article
      className={`round__card${selected ? ' is-selected' : ''}${colorRoles ? ' is-painted' : ''}`}
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
        <ReplyEditor
          ref={setEditor}
          id={`reply-${point.id}`}
          value={draft}
          onChange={setDraft}
          onCommit={onReply}
          onRevert={() => {
            setDraft(state.reply)
            return state.reply
          }}
          placeholder="Answer this point. Type :: to quote the manuscript."
          colorRoles={colorRoles}
          quickInsert={quickInsert}
          reports={reports}
          point={point}
        />
      </div>

      {/*
        One footer row under the box: what you can insert, what you decided,
        and what the AI can do about it. They are the three things you do to a
        reply and they belong on the same line — a full-width AI strip above
        the statuses read as part of the reply itself.

        A grid rather than a flex row because ReplyAssistant is more than its
        button bar: its busy strip and its proposal must span the whole width
        underneath both groups, which they do via `display: contents` on the
        assistant's own root (documents.css).
      */}
      <div className="round__foot">
        {quickInsert && <ReplyQuickBar editor={editor} reports={reports} point={point} />}
        <div className="round__status">
          {statusesFor(state.status).map((s) => (
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
