import { useCallback, useMemo, useState, type DragEvent, type JSX } from 'react'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { useDocumentsStore, refreshDocuments } from '../state/documents'
import { openRoundTab } from '../state/dock'
import './documents.css'

/**
 * Import reviewer comments (document-kinds-ux.md §B).
 *
 * Two steps, because confirming is a step: analyse renders the review screen
 * and writes nothing; Import writes the reviewer records. The DocxImportTab
 * contract, applied to the flow where getting it wrong means misquoting a
 * reviewer.
 *
 * A file and a paste box are not two flows — they are two ways to produce one
 * string, so one screen does both. The paste box matters more than it looks:
 * editorial decisions arrive as email body text at least as often as
 * attachments, and every tool that demands a file forces the user to make one.
 */

interface WirePoint {
  id: string
  reviewerIndex: number
  pointIndex: number
  section: string | null
  from: number
  to: number
  verbatim: string
  reason: string
  /** The author's own reply, when the source was a response document. */
  reply: { number: number; from: number; to: number; text: string } | null
}
interface WireReviewer {
  index: number
  label: string
  from: number
  to: number
  points: WirePoint[]
  headings: { from: number; to: number }[]
}
interface Analysis {
  sourceText: string
  reviewers: WireReviewer[]
  preamble: string
  unassigned: { from: number; to: number; text: string }[]
  coveragePercent: number
  totalPoints: number
  unsplitReviewers: number[]
  replyGaps: number[]
}

export function ReviewImportTab({ params }: DockPanelProps): JSX.Element {
  const rootDir = String(params?.['rootDir'] ?? '')
  const rounds = useDocumentsStore((s) => s.rounds)

  const [pasted, setPasted] = useState('')
  const [dropping, setDropping] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [roundId, setRoundId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ reviewers: number; points: number } | null>(null)

  const analyse = useCallback(
    async (input: { text: string | null; path: string | null }) => {
      setBusy(true)
      setError(null)
      try {
        const res = (await window.suna.invoke('review:analyse', input)) as Analysis
        setAnalysis(res)
        if (roundId === '' && rounds[0] !== undefined) setRoundId(rounds[0].id)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [rounds, roundId]
  )

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDropping(false)
    const file = e.dataTransfer.files[0]
    // Electron exposes the real path on a dropped File; without it there is
    // nothing the main process can open, so we say so rather than failing mute.
    const path = (file as unknown as { path?: string } | undefined)?.path
    if (path === undefined) {
      setError('Could not read that file’s path — paste its text instead.')
      return
    }
    void analyse({ text: null, path })
  }

  const commit = async (): Promise<void> => {
    if (analysis === null || busy) return
    setBusy(true)
    setError(null)
    try {
      // A first import has no round to land in, and making the user create
      // one first is a step with no decision in it — the reviewer reports
      // ARE the round. So one is opened here when none was picked.
      let target = roundId
      if (target === '') {
        const n = rounds.length + 1
        const { round } = await window.suna.invoke('round:new', {
          dir: rootDir,
          id: `round-${n}`,
          kind: 'external',
          label: `Round ${n}`
        })
        target = round.id
        setRoundId(target)
      }
      const res = await window.suna.invoke('review:commit', {
        dir: rootDir,
        roundId: target,
        sourceText: analysis.sourceText,
        preamble: analysis.preamble,
        reviewers: analysis.reviewers,
        unassigned: analysis.unassigned
      })
      setDone(res)
      refreshDocuments()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (done !== null) {
    return (
      <div className="rvimp rvimp--done">
        <h2>Imported</h2>
        <p>
          {done.points} point{done.points === 1 ? '' : 's'} from {done.reviewers} reviewer
          {done.reviewers === 1 ? '' : 's'}.
        </p>
        <button className="is-primary" onClick={() => openRoundTab(rootDir, roundId)}>
          Open the round
        </button>
      </div>
    )
  }

  if (analysis === null) {
    return (
      <div className="rvimp">
        <header className="rvimp__head">
          <h2>Import reviewer comments</h2>
          <p>Drop the decision letter, or paste it below. Nothing is written until you confirm.</p>
          <p className="rvimp__hint">
            Paste it <strong>exactly as it arrived</strong> — blank lines, numbering and
            reviewer headings are what the split reads. Tidying the letter first is the
            usual reason a point goes missing.
          </p>
        </header>

        <div
          className={`rvimp__drop${dropping ? ' is-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDropping(true)
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
        >
          <strong>Drop the decision letter here</strong>
          <span>.docx · .pdf · .html · .txt</span>
        </div>

        <div className="rvimp__or">— or paste it —</div>

        <textarea
          className="rvimp__paste"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder={'Reviewer #1 (Comments for the Author):\n\nMajor issues\n1. …'}
          spellCheck={false}
        />

        {error !== null && <p className="sheet__error">{error}</p>}

        <div className="rvimp__actions">
          <button
            className="is-primary"
            disabled={busy || pasted.trim() === ''}
            onClick={() => void analyse({ text: pasted, path: null })}
          >
            {busy ? 'Reading…' : 'Analyse'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <ReviewScreen
      analysis={analysis}
      rounds={rounds.map((r) => ({ id: r.id, label: r.label }))}
      roundId={roundId}
      setRoundId={setRoundId}
      busy={busy}
      error={error}
      onBack={() => setAnalysis(null)}
      onCommit={() => void commit()}
      onChange={setAnalysis}
    />
  )
}

/**
 * The two-column review screen. Left: the source with every assigned span
 * highlighted. Right: the proposed points, each saying WHY it was detected.
 *
 * The coverage meter is the safety rail. The real failure mode is not a
 * mis-split, it is a silently dropped paragraph — which is exactly the defect
 * in the evidence set, where a hand-maintained response reached RE83 with
 * RE58 missing. You may import at 94%; you may not import at 94% without
 * seeing it.
 */
function ReviewScreen(props: {
  analysis: Analysis
  rounds: { id: string; label: string }[]
  roundId: string
  setRoundId: (id: string) => void
  busy: boolean
  error: string | null
  onBack: () => void
  onCommit: () => void
  onChange: (a: Analysis) => void
}): JSX.Element {
  const { analysis } = props
  const [selected, setSelected] = useState<string | null>(null)

  const dropPoint = (reviewerIndex: number, pointId: string): void => {
    props.onChange({
      ...analysis,
      reviewers: analysis.reviewers.map((r) =>
        r.index === reviewerIndex ? { ...r, points: r.points.filter((p) => p.id !== pointId) } : r
      ),
      totalPoints: analysis.totalPoints - 1
    })
  }

  const mergeUp = (reviewerIndex: number, pointId: string): void => {
    props.onChange({
      ...analysis,
      reviewers: analysis.reviewers.map((r) => {
        if (r.index !== reviewerIndex) return r
        const i = r.points.findIndex((p) => p.id === pointId)
        if (i <= 0) return r
        const prev = r.points[i - 1]!
        const cur = r.points[i]!
        // Merging re-slices the SOURCE between the two spans rather than
        // concatenating the two verbatims, so the result stays a contiguous
        // slice — the invariant the commit step refuses to import without.
        const merged: WirePoint = {
          ...prev,
          to: cur.to,
          verbatim: analysis.sourceText.slice(prev.from, cur.to),
          reason: `${prev.reason} + merged`
        }
        const next = [...r.points]
        next.splice(i - 1, 2, merged)
        return { ...r, points: next.map((p, n) => ({ ...p, pointIndex: n + 1 })) }
      }),
      totalPoints: analysis.totalPoints - 1
    })
  }

  const segments = useMemo(() => buildSegments(analysis), [analysis])

  return (
    <div className="rvimp rvimp--review">
      <header className="rvimp__head rvimp__head--row">
        <div>
          <h2>{analysis.totalPoints} points found</h2>
          <p>Every card says why it was detected. Correct anything wrong before importing.</p>
        </div>
        <div className="rvimp__round">
          <label htmlFor="rvimp-round">Import into</label>
          <select
            id="rvimp-round"
            value={props.roundId}
            onChange={(e) => props.setRoundId(e.target.value)}
          >
            <option value="">Choose a round…</option>
            {props.rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="rvimp__cols">
        <div className="rvimp__source">
          {segments.map((seg, i) => (
            <span
              key={i}
              className={
                seg.kind === 'point'
                  ? `rvimp__seg is-point${selected === seg.pointId ? ' is-selected' : ''}`
                  : seg.kind === 'gap'
                    ? 'rvimp__seg is-gap'
                    : seg.kind === 'head'
                      ? 'rvimp__seg is-head'
                      : 'rvimp__seg'
              }
              onClick={() => seg.kind === 'point' && setSelected(seg.pointId ?? null)}
            >
              {seg.text}
            </span>
          ))}
        </div>

        <div className="rvimp__points">
          {analysis.reviewers.map((r) => (
            <section key={r.index}>
              <h3>
                {r.label}
                <span className="rvimp__count">
                  {r.points.length} point{r.points.length === 1 ? '' : 's'}
                </span>
              </h3>
              {r.points.length === 0 && (
                <p className="rvimp__empty">
                  Nothing was split out of this reviewer’s text. It will import as no points at
                  all — merge it into another reviewer or fix the source above.
                </p>
              )}
              {r.points.map((p) => (
                <article
                  key={p.id}
                  className={`rvimp__card${selected === p.id ? ' is-selected' : ''}`}
                  onClick={() => setSelected(p.id)}
                >
                  <header>
                    <span className="rvimp__pid">
                      {r.index}.{p.pointIndex}
                    </span>
                    <span className="rvimp__why">
                      {p.reason}
                      {p.section !== null && ` · ${p.section}`}
                    </span>
                  </header>
                  <p>{p.verbatim.replace(/\s+/g, ' ').trim()}</p>
                  {p.reply !== null && (
                    <p className="rvimp__reply">
                      <span>RE{p.reply.number}</span>
                      {p.reply.text.replace(/^\[?RE\s?\d{1,3}\s*:\]?/, '').replace(/\s+/g, ' ').trim()}
                    </p>
                  )}
                  <footer>
                    <button onClick={() => mergeUp(r.index, p.id)} disabled={p.pointIndex === 1}>
                      Merge up
                    </button>
                    <button onClick={() => dropPoint(r.index, p.id)}>Not a point</button>
                  </footer>
                </article>
              ))}
            </section>
          ))}
        </div>
      </div>

      <footer className="rvimp__foot">
        <div className="rvimp__meter">
          <div className="rvimp__meter-bar">
            <span style={{ width: `${analysis.coveragePercent}%` }} />
          </div>
          <span>
            {analysis.coveragePercent}% of the source is assigned to a point
            {analysis.unassigned.length > 0 && (
              <strong>
                {' '}
                · {analysis.unassigned.length} unassigned span
                {analysis.unassigned.length === 1 ? '' : 's'}
              </strong>
            )}
            {analysis.replyGaps.length > 0 && (
              <strong>
                {' '}
                · reply {analysis.replyGaps.length === 1 ? 'number' : 'numbers'}{' '}
                {analysis.replyGaps.join(', ')} missing from the source
              </strong>
            )}
          </span>
        </div>
        {props.error !== null && <p className="sheet__error">{props.error}</p>}
        <div className="rvimp__actions">
          <button onClick={props.onBack} disabled={props.busy}>
            Back
          </button>
          <button
            className="is-primary"
            onClick={props.onCommit}
            disabled={props.busy || props.roundId === '' || analysis.totalPoints === 0}
          >
            {props.busy ? 'Importing…' : `Import ${analysis.totalPoints} points`}
          </button>
        </div>
      </footer>
    </div>
  )
}

interface Segment {
  kind: 'plain' | 'point' | 'gap' | 'head'
  text: string
  pointId?: string
}

/**
 * The source split into spans: assigned to a point, an unassigned gap inside
 * a reviewer block, or plain (the editor's letter and the headings). The
 * three cover the whole string with no overlap, which is the property that
 * makes the coverage meter mean something.
 */
function buildSegments(a: Analysis): Segment[] {
  const marks: { from: number; to: number; kind: 'point' | 'gap' | 'head'; pointId?: string }[] = []
  for (const r of a.reviewers) {
    for (const p of r.points) marks.push({ from: p.from, to: p.to, kind: 'point', pointId: p.id })
    for (const h of r.headings) marks.push({ from: h.from, to: h.to, kind: 'head' })
  }
  for (const u of a.unassigned) marks.push({ from: u.from, to: u.to, kind: 'gap' })
  marks.sort((x, y) => x.from - y.from)

  const out: Segment[] = []
  let at = 0
  for (const m of marks) {
    if (m.from < at) continue
    if (m.from > at) out.push({ kind: 'plain', text: a.sourceText.slice(at, m.from) })
    out.push({
      kind: m.kind,
      text: a.sourceText.slice(m.from, m.to),
      ...(m.pointId === undefined ? {} : { pointId: m.pointId })
    })
    at = m.to
  }
  if (at < a.sourceText.length) out.push({ kind: 'plain', text: a.sourceText.slice(at) })
  return out
}
