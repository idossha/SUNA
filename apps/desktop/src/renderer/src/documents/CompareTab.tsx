import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  diffBibliography,
  diffFields,
  diffSections,
  pairCompareFields,
  parseCompareRefId,
  pointStateFor,
  type BibEntryDiff,
  type CompareDocument,
  type CompareSide,
  type DiffOp,
  type SectionChange
} from '@suna/core'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { useRoundFocusStore } from '../state/roundFocus'
import { roundChangedOnDisk } from '../state/roundSync'
import { useUiStore } from '../state/ui'
import {
  groupSegments,
  hunkCount,
  paragraphAround,
  quoteBlockFor,
  segmentsFor,
  splitRows,
  type CompareSegment
} from './compareSegments'
import './documents.css'
import './compare.css'

/**
 * The version comparison (DECISIONS 2026-08-21).
 *
 * The question this answers is the one every response letter is built on:
 * *what did we change since the reviewers read it?* Two sides, picked at the
 * top — by default the round's own baseline against the working copy — and
 * the difference between them, section by section.
 *
 * Three decisions worth stating, because each rules out an easier thing:
 *
 * **Everything is derived.** Nothing about a comparison is stored. The base
 * side is a read-only archive folder and the head side is usually the file
 * you are still typing into, so the only correct answer is one recomputed
 * from both texts on every read — the same discipline the AI-revision review
 * bar follows, for the same reason.
 *
 * **Structure before words.** The diff is run per section, against the
 * matching section on the other side, so an inserted "Limitations" does not
 * make every heading after it read as rewritten. That is `diffSections` in
 * `@suna/core`; this file only paints what it returns.
 *
 * **A comparison is a source for the letter, not just a picture.** Every
 * change carries a quote button: it takes the paragraph around the change
 * from the CURRENT manuscript, marks the new words with the `+++` the reply
 * markup already understands, and puts it in the reply you have open — which
 * is exactly the sentence a response letter needs and the step that is
 * otherwise done by hand, badly, forty times per revision.
 */

type Layout = 'unified' | 'split'

/** A card in the body: a manuscript section, or a metadata field. */
interface Block {
  key: string
  label: string
  breadcrumb: string
  change: SectionChange
  level: number
  baseText: string
  headText: string
  ops: DiffOp[]
  wordsAdded: number
  wordsRemoved: number
}

export function CompareTab({ params }: DockPanelProps): JSX.Element {
  const rootDir = String(params?.['rootDir'] ?? '')

  const [sides, setSides] = useState<CompareSide[]>([])
  const [baseId, setBaseId] = useState(String(params?.['base'] ?? 'working'))
  const [headId, setHeadId] = useState(String(params?.['head'] ?? 'working'))
  const [base, setBase] = useState<CompareDocument | null>(null)
  const [head, setHead] = useState<CompareDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [layout, setLayout] = useState<Layout>('unified')
  const [changesOnly, setChangesOnly] = useState(true)
  const [current, setCurrent] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    window.suna
      .invoke('compare:sides', { dir: rootDir })
      .then((res) => {
        if (live) setSides(res.sides)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [rootDir])

  const read = useCallback(
    async (id: string): Promise<CompareDocument | null> => {
      const ref = parseCompareRefId(id)
      if (ref === null) return null
      const { document } = await window.suna.invoke('compare:read', { dir: rootDir, ref })
      return document
    },
    [rootDir]
  )

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [b, h] = await Promise.all([read(baseId), read(headId)])
      setBase(b)
      setHead(h)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [read, baseId, headId])

  useEffect(() => {
    void reload()
  }, [reload])

  // The working copy is a file the author is still editing, and a comparison
  // that silently showed yesterday's text would be worse than none. Re-read
  // whenever this panel comes back to the front.
  useEffect(() => {
    const onFocus = (): void => void reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  const blocks = useMemo<Block[]>(() => {
    if (base === null || head === null) return []
    const out: Block[] = []
    for (const section of diffSections(base.markdown, head.markdown)) {
      out.push({
        key: `s:${section.id}`,
        label: section.title === '' ? 'Opening' : section.title,
        breadcrumb: section.ancestors.join(' › '),
        change: section.change,
        level: section.level,
        baseText: section.baseText,
        headText: section.headText,
        ops: section.ops,
        wordsAdded: section.wordsAdded,
        wordsRemoved: section.wordsRemoved
      })
    }
    for (const field of diffFields(pairCompareFields(base.fields, head.fields))) {
      out.push({
        key: `f:${field.id}`,
        label: field.label,
        breadcrumb: 'Title page & back matter',
        change: field.baseText === '' ? 'added' : field.headText === '' ? 'removed' : 'modified',
        level: 2,
        baseText: field.baseText,
        headText: field.headText,
        ops: field.ops,
        wordsAdded: field.wordsAdded,
        wordsRemoved: field.wordsRemoved
      })
    }
    return out
  }, [base, head])

  const references = useMemo<BibEntryDiff[]>(
    () => (base === null || head === null ? [] : diffBibliography(base.bibliography, head.bibliography)),
    [base, head]
  )

  // Off `blocks`, not a second `diffSections` call: the totals in the header
  // must be the totals of what the body is showing, metadata fields included,
  // and running the whole diff twice to disagree with itself is the worst of
  // both.
  const stats = useMemo(() => {
    if (blocks.length === 0) return null
    const sections = blocks.filter((b) => b.key.startsWith('s:'))
    return {
      wordsAdded: blocks.reduce((n, b) => n + b.wordsAdded, 0),
      wordsRemoved: blocks.reduce((n, b) => n + b.wordsRemoved, 0),
      sectionsChanged: sections.filter((b) => b.change !== 'unchanged').length,
      sectionsTotal: sections.length
    }
  }, [blocks])

  // Segments per block, and the global change numbering the ‹ › buttons walk.
  const rendered = useMemo(() => {
    let next = 0
    return blocks.map((block) => {
      const segments = segmentsFor(block.baseText, block.headText, block.ops)
      const first = next
      next += hunkCount(segments)
      return { block, segments, firstChange: first }
    })
  }, [blocks])

  const totalChanges = useMemo(
    () => rendered.reduce((n, r) => n + hunkCount(r.segments), 0),
    [rendered]
  )

  const shown = changesOnly ? rendered.filter((r) => r.block.change !== 'unchanged') : rendered

  // A ref beside the state, because ‹ › are clicked faster than React
  // re-renders: two clicks in one frame both read the same `current` from
  // their closure and land on the same change. The ref is the value the next
  // click steps from; the state is what the header paints.
  const currentRef = useRef(0)
  const goto = useCallback(
    (index: number): void => {
      if (totalChanges === 0) return
      const wrapped = ((index % totalChanges) + totalChanges) % totalChanges
      currentRef.current = wrapped
      setCurrent(wrapped)
      const node = bodyRef.current?.querySelector(`[data-change="${wrapped}"]`)
      node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    [totalChanges]
  )
  const step = useCallback((delta: number): void => goto(currentRef.current + delta), [goto])

  // Changing a side changes what the numbering means, and "change 12 of 4" is
  // a worse answer than starting again at the top.
  useEffect(() => {
    currentRef.current = 0
    setCurrent(0)
  }, [totalChanges])

  const swap = (): void => {
    setBaseId(headId)
    setHeadId(baseId)
  }

  const bothWays = base?.problem ?? head?.problem ?? error

  return (
    <div className="cmp">
      <header className="cmp__head">
        <div className="cmp__sides">
          <SidePicker
            /* The left side is whatever you point it at — a logged version,
               the working copy, or "what the reviewers of this round read".
               Naming it after only the last of those mislabels the other
               two, so the label follows the ref. */
            label={baseId.startsWith('round:') ? 'Reviewers read' : 'Before'}
            value={baseId}
            sides={sides}
            onChange={setBaseId}
            sub={base?.sublabel ?? ''}
          />
          <button className="cmp__swap" onClick={swap} title="Swap the two sides">
            ⇄
          </button>
          <SidePicker
            label={baseId.startsWith('round:') ? 'Compared with' : 'After'}
            value={headId}
            sides={sides}
            onChange={setHeadId}
            sub={head?.sublabel ?? ''}
          />
        </div>

        <div className="cmp__tools">
          {stats !== null && bothWays == null && (
            <span className="cmp__stats">
              <strong>{totalChanges}</strong> change{totalChanges === 1 ? '' : 's'}
              <span className="cmp__plus"> +{stats.wordsAdded}</span>
              <span className="cmp__minus"> −{stats.wordsRemoved}</span>
              <span className="cmp__quiet">
                {' '}
                · {stats.sectionsChanged} of {stats.sectionsTotal} sections
              </span>
            </span>
          )}
          <div className="cmp__nav" role="group" aria-label="Move between changes">
            <button onClick={() => step(-1)} disabled={totalChanges === 0} title="Previous change">
              ‹
            </button>
            <span className="cmp__navat">
              {totalChanges === 0 ? '—' : `${current + 1}/${totalChanges}`}
            </span>
            <button onClick={() => step(1)} disabled={totalChanges === 0} title="Next change">
              ›
            </button>
          </div>
          <label className="cmp__only" title="Hide sections that did not change">
            <input
              type="checkbox"
              checked={changesOnly}
              onChange={(e) => setChangesOnly(e.target.checked)}
            />
            Changes only
          </label>
          <div className="cmp__layout" role="group" aria-label="Layout">
            <button
              className={layout === 'unified' ? 'is-on' : ''}
              onClick={() => setLayout('unified')}
              title="One column: removals struck through, additions in place"
            >
              Unified
            </button>
            <button
              className={layout === 'split' ? 'is-on' : ''}
              onClick={() => setLayout('split')}
              title="Two columns: what they read, and what it says now"
            >
              Side by side
            </button>
          </div>
        </div>
      </header>

      <div className="cmp__body" ref={bodyRef}>
        {loading && base === null && <p className="cmp__note">Reading both versions…</p>}
        {bothWays != null && <p className="cmp__problem">{bothWays}</p>}
        {bothWays == null && !loading && totalChanges === 0 && references.length === 0 && (
          <p className="cmp__note">
            No differences between {base?.label} and {head?.label}.
          </p>
        )}
        {bothWays == null &&
          shown.map(({ block, segments, firstChange }) => (
            <CompareBlockCard
              key={block.key}
              block={block}
              segments={segments}
              firstChange={firstChange}
              layout={layout}
              current={current}
              rootDir={rootDir}
            />
          ))}
        {bothWays == null && references.length > 0 && (
          <ReferenceChanges entries={references} />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The pickers                                                          */
/* ------------------------------------------------------------------ */

function SidePicker({
  label,
  value,
  sides,
  onChange,
  sub
}: {
  label: string
  value: string
  sides: readonly CompareSide[]
  onChange: (id: string) => void
  sub: string
}): JSX.Element {
  return (
    <label className="cmp__side">
      <span className="cmp__sidelabel">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {sides.map((side) => (
          <option key={side.id} value={side.id}>
            {side.label}
            {side.sublabel === '' ? '' : ` — ${side.sublabel}`}
          </option>
        ))}
        {/* A side the project no longer has still has to be selectable, or the
            picker would silently jump to another version's text. */}
        {!sides.some((s) => s.id === value) && <option value={value}>{value}</option>}
      </select>
      <span className="cmp__sidesub">{sub}</span>
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* One card                                                             */
/* ------------------------------------------------------------------ */

const CHANGE_LABEL: Record<SectionChange, string> = {
  unchanged: 'unchanged',
  modified: 'changed',
  added: 'new',
  removed: 'deleted'
}

function CompareBlockCard({
  block,
  segments,
  firstChange,
  layout,
  current,
  rootDir
}: {
  block: Block
  segments: readonly CompareSegment[]
  /** Global index of this card's first change — the ‹ › nav's coordinates. */
  firstChange: number
  layout: Layout
  current: number
  rootDir: string
}): JSX.Element {
  const quote = useQuoteAction(rootDir)

  const quoteRange = (from: number, to: number): void => {
    void quote(quoteBlockFor(block.headText, segments, from, to))
  }

  const quoteHunk = (hunk: number): void => {
    const marks = segments.filter((s) => s.hunk === hunk && s.kind !== 'delete')
    // A pure deletion has no head text to quote; fall back to the paragraph
    // the removal sat between, which is the sentence the letter is about.
    const anchor = marks[0]
    const at = anchor?.from ?? nearestHeadOffset(segments, hunk)
    const end = anchor === undefined ? at : anchor.from + anchor.text.length
    const para = paragraphAround(block.headText, at, end)
    quoteRange(para.from, para.to)
  }

  return (
    <section className={`cmp__card is-${block.change}`}>
      <header className="cmp__cardhead">
        <div>
          {block.breadcrumb !== '' && <span className="cmp__crumb">{block.breadcrumb} › </span>}
          <h3>{block.label}</h3>
        </div>
        <span className={`cmp__badge is-${block.change}`}>{CHANGE_LABEL[block.change]}</span>
        {(block.wordsAdded > 0 || block.wordsRemoved > 0) && (
          <span className="cmp__cardstats">
            <span className="cmp__plus">+{block.wordsAdded}</span>{' '}
            <span className="cmp__minus">−{block.wordsRemoved}</span>
          </span>
        )}
        <button
          className="cmp__quoteall"
          onClick={() => quoteRange(0, block.headText.length)}
          disabled={block.headText === ''}
          title="Quote this whole section in the open reply, with the new words marked"
        >
          Quote section
        </button>
      </header>

      {layout === 'unified' ? (
        <div className="cmp__prose cmp__prose--unified" data-block={block.key}>
          <Run
            segments={segments}
            firstChange={firstChange}
            current={current}
            onQuote={quoteHunk}
          />
        </div>
      ) : (
        // One grid row per shared paragraph break, so the two columns start
        // level at every point the versions provably agree on — without
        // which the side that gained a sentence pushes everything below it
        // out of step with its counterpart.
        <div className="cmp__cols" data-block={block.key}>
          {splitRows(segments).map((row, r) => (
            <div className="cmp__row" key={r}>
              <div className="cmp__prose cmp__prose--base">
                <Run
                  segments={row.segments.filter((seg) => seg.kind !== 'insert')}
                  firstChange={firstChange}
                  current={current}
                  side="base"
                />
              </div>
              <div className="cmp__prose cmp__prose--head">
                <Run
                  segments={row.segments.filter((seg) => seg.kind !== 'delete')}
                  firstChange={firstChange}
                  current={current}
                  onQuote={quoteHunk}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Where in the head text a deletion-only hunk sat, for quoting around it. */
function nearestHeadOffset(segments: readonly CompareSegment[], hunk: number): number {
  let at = 0
  for (const segment of segments) {
    if (segment.hunk === hunk) return at
    if (segment.kind !== 'delete') at = segment.from + segment.text.length
  }
  return at
}

/**
 * A run of prose with its changes marked.
 *
 * Everything a single change is made of — the words removed and the words
 * that replaced them — is painted as ONE element with one outline and one
 * quote button, because that is what it is. Painted per segment it would read
 * as three changes where the author made one.
 */
function Run({
  segments,
  firstChange,
  current,
  side = 'head',
  onQuote
}: {
  segments: readonly CompareSegment[]
  firstChange: number
  current: number
  side?: 'base' | 'head'
  onQuote?: (hunk: number) => void
}): JSX.Element {
  return (
    <>
      {groupSegments(segments).map((group, i) => {
        if (group.kind === 'equal') {
          return (
            <span key={i} className="cmp__eq" data-side={side} data-off={group.segment.from}>
              {group.segment.text}
            </span>
          )
        }
        const index = firstChange + group.hunk
        return (
          <span
            key={i}
            className={`cmp__hunk${index === current ? ' is-current' : ''}`}
            data-change={index}
          >
            {group.segments.map((segment, j) => (
              <span
                key={j}
                className={segment.kind === 'insert' ? 'cmp__ins' : 'cmp__del'}
                data-side={segment.kind === 'insert' ? side : 'base'}
                data-off={segment.from}
              >
                {segment.text}
              </span>
            ))}
            {onQuote !== undefined && (
              <button
                className="cmp__quotehunk"
                title="Quote this paragraph in the open reply, with the new words marked"
                onClick={() => onQuote(group.hunk)}
              >
                ❝
              </button>
            )}
          </span>
        )
      })}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* References                                                           */
/* ------------------------------------------------------------------ */

function ReferenceChanges({ entries }: { entries: readonly BibEntryDiff[] }): JSX.Element {
  return (
    <section className="cmp__card is-modified">
      <header className="cmp__cardhead">
        <div>
          <span className="cmp__crumb">Bibliography › </span>
          <h3>References</h3>
        </div>
        <span className="cmp__badge is-modified">
          {entries.length} change{entries.length === 1 ? '' : 's'}
        </span>
      </header>
      <ul className="cmp__bib">
        {entries.map((entry) => (
          <li key={entry.citekey} className={`cmp__bibrow is-${entry.change}`}>
            <span className="cmp__bibmark">
              {entry.change === 'added' ? '+' : entry.change === 'removed' ? '−' : '~'}
            </span>
            <code>{entry.citekey}</code>
            <span className="cmp__bibwhat">{entry.change}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Quoting into a reply                                                 */
/* ------------------------------------------------------------------ */

/**
 * Put a quote block where the author is working.
 *
 * The target is the point the round workspace has focused — the same
 * selection its outline and its second pane already share — so quoting is one
 * click with no second picker asking which of eighty-four points you meant.
 *
 * It goes through `review:set-point`, the same IPC the workspace itself
 * writes with, rather than reaching into the round tab's state: two surfaces
 * owning one reply is how the reply gets clobbered. The workspace re-reads on
 * the tick that follows. With no point focused — or no round open — the block
 * goes to the clipboard instead and the status bar says so, which is still
 * the useful half of the feature when the comparison is being read on its own.
 */
function useQuoteAction(rootDir: string): (block: string) => Promise<void> {
  const roundId = useRoundFocusStore((s) => s.roundId)
  const activePane = useRoundFocusStore((s) => s.activePane)
  const pointId = useRoundFocusStore((s) => s.points[activePane])

  return useCallback(
    async (block: string): Promise<void> => {
      const note = useUiStore.getState().setStatusNote
      if (roundId === null || pointId === null) {
        await navigator.clipboard.writeText(block).catch(() => undefined)
        note('Quote copied — open a reviewer point to insert it into a reply.')
        return
      }
      try {
        const { round } = await window.suna.invoke('round:read', { dir: rootDir, roundId })
        const state = pointStateFor(round, pointId)
        const reply = state.reply === '' ? block : `${state.reply.replace(/\s*$/, '')}\n\n${block}`
        await window.suna.invoke('review:set-point', {
          dir: rootDir,
          roundId,
          pointId,
          status: state.status === 'unaddressed' ? 'drafted' : state.status,
          reply
        })
        roundChangedOnDisk(roundId)
        note('Quote inserted into the open reply.')
      } catch (err) {
        note(`Could not insert the quote — ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [rootDir, roundId, pointId]
  )
}
