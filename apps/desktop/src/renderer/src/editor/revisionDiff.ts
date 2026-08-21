import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { hunksFromOps, wordDiff, type DiffOp } from '@suna/core'

/**
 * Word-level AI-change decorations (feature-plan-11 §11f) — removals in red,
 * additions in green, at the resolution of the words that actually changed.
 *
 * Everything is DERIVED, nothing is stored. The baseline (the manuscript's
 * text before the AI run, from manuscript/revisions.json) is diffed against
 * the live document on every change, so hunks stay correct however much the
 * author edits around them and there is no hunk-migration logic to get wrong.
 * At ~5 ms for a one-word edit in a 1 MB document this is cheaper than the
 * bookkeeping the alternative would need.
 *
 * Additions exist in the document, so they are mark decorations over the live
 * text. Removals do NOT — the text is gone — so each is a widget rendering the
 * removed words inline. That widget is deliberately inert: `contenteditable`
 * false, `user-select: none`, and no part of the document's text, so nothing
 * it shows can reach an export, a word count or the clipboard.
 */

/** Set (or clear, with null) the baseline this editor diffs against. */
export const setRevisionBase = StateEffect.define<string | null>()

class RemovedWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }

  eq(other: RemovedWidget): boolean {
    return other.text === this.text
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-sunaDiff-del'
    span.setAttribute('contenteditable', 'false')
    span.setAttribute('aria-label', `removed: ${this.text}`)
    // Newlines in removed prose would break the line box; show them as a
    // pilcrow so a deleted paragraph break is still visible as one.
    span.textContent = this.text.replace(/\n/g, '¶')
    return span
  }

  ignoreEvent(): boolean {
    return false
  }
}

const addedMark = Decoration.mark({ class: 'cm-sunaDiff-ins' })

/** One reviewable change, in LIVE-document coordinates. */
export interface DiffHunk {
  /** Range of added text in the live document; from === to for a pure removal. */
  from: number
  to: number
  /** The words this replaced, in the baseline. Empty for a pure addition. */
  removed: string
  /** Baseline range this hunk covers, for advancing the base on accept. */
  baseFrom: number
  baseTo: number
}

/**
 * Fold the op list into reviewable hunks: a removal and the addition that
 * replaces it are ONE change to accept or reject, not two.
 *
 * The fold itself lives in `@suna/core` (`hunksFromOps`), shared with the
 * version comparison view — one algorithm, one set of tests. What is added
 * here is the live-document shape this editor works in: the removed text
 * itself, sliced out of the baseline for the red widget to render.
 */
export function hunksFor(base: string, doc: string): DiffHunk[] {
  if (base === doc) return []
  const ops: DiffOp[] = wordDiff(base, doc)
  return hunksFromOps(ops).map((h) => ({
    from: h.headFrom,
    to: h.headTo,
    removed: base.slice(h.baseFrom, h.baseTo),
    baseFrom: h.baseFrom,
    baseTo: h.baseTo
  }))
}

function decorationsFor(base: string | null, doc: string): DecorationSet {
  if (base === null) return Decoration.none
  const ranges: Range<Decoration>[] = []
  for (const hunk of hunksFor(base, doc)) {
    if (hunk.removed.length > 0) {
      // side -1 keeps the removed text to the LEFT of the addition replacing
      // it, so a replacement reads old-then-new the way a diff does.
      ranges.push(Decoration.widget({ widget: new RemovedWidget(hunk.removed), side: -1 }).range(hunk.from))
    }
    if (hunk.to > hunk.from) ranges.push(addedMark.range(hunk.from, hunk.to))
  }
  return Decoration.set(ranges, true)
}

/** The baseline currently in force for this editor, or null when reviewing is off. */
export const revisionBaseField = StateField.define<string | null>({
  create: () => null,
  update: (base, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setRevisionBase)) return effect.value
    }
    return base
  }
})

const diffField = StateField.define<DecorationSet>({
  create: (state) => decorationsFor(state.field(revisionBaseField), state.doc.toString()),
  update: (deco, tr) => {
    const baseChanged = tr.effects.some((e) => e.is(setRevisionBase))
    if (!tr.docChanged && !baseChanged) return deco
    return decorationsFor(tr.state.field(revisionBaseField), tr.state.doc.toString())
  },
  provide: (f) => EditorView.decorations.from(f)
})

const diffTheme = EditorView.baseTheme({
  // Both marks are click targets — clicking one opens its accept/reject
  // popover (editor/revisionReview.ts), which is the whole discoverability
  // story for per-hunk review.
  '.cm-sunaDiff-ins, .cm-sunaDiff-del': { cursor: 'pointer' },
  '.cm-sunaDiff-actions': {
    display: 'flex',
    gap: '4px',
    padding: '3px',
    borderRadius: 'var(--s-radius, 4px)',
    border: '1px solid var(--s-border-strong)',
    background: 'var(--s-bg-raised)',
    fontFamily: 'var(--s-font-ui)',
    fontSize: 'var(--s-text-xs, 11px)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.28)'
  },
  '.cm-sunaDiff-action': {
    padding: '2px 8px',
    border: '1px solid var(--s-border-strong)',
    borderRadius: 'var(--s-radius, 4px)',
    background: 'transparent',
    color: 'var(--s-ink)',
    cursor: 'pointer',
    font: 'inherit'
  },
  '.cm-sunaDiff-action--accept:hover': {
    borderColor: 'var(--s-ok)',
    color: 'var(--s-ok)'
  },
  '.cm-sunaDiff-action--reject:hover': {
    borderColor: 'var(--s-err)',
    color: 'var(--s-err)'
  },
  '.cm-sunaDiff-ins': {
    // The word itself carries the saturated tint; the surrounding line is left
    // alone so a one-word change does not read as a whole-line rewrite.
    backgroundColor: 'color-mix(in srgb, var(--s-diff-ins, var(--s-ok)) 30%, transparent)',
    borderRadius: '2px'
  },
  '.cm-sunaDiff-del': {
    backgroundColor: 'color-mix(in srgb, var(--s-err) 26%, transparent)',
    color: 'var(--s-err)',
    textDecoration: 'line-through',
    borderRadius: '2px',
    padding: '0 2px',
    // A replacement renders as removal-then-addition with nothing between
    // them, and without this they read as one run-together word
    // ("spectacularlydramatically"). Margin, not a text separator: whatever
    // this widget shows must stay out of the document.
    marginRight: '3px',
    // Never selectable: what this shows is not in the document, and it must
    // not reach an export, a word count or the clipboard.
    userSelect: 'none',
    cursor: 'default'
  }
})

/* ---- change notifications for the review bar ------------------------------ */

const diffListeners = new Set<() => void>()

/** Subscribe to "the hunks may have changed" (doc edited, or base replaced). */
export function onDiffChanged(listener: () => void): () => void {
  diffListeners.add(listener)
  return () => diffListeners.delete(listener)
}

function notifyDiffChanged(): void {
  for (const listener of diffListeners) listener()
}

/** Live hunks for the review bar and the accept/reject commands. */
export function revisionHunks(view: EditorView): DiffHunk[] {
  const base = view.state.field(revisionBaseField, false) ?? null
  if (base === null) return []
  return hunksFor(base, view.state.doc.toString())
}

export function revisionDiffExtension(): Extension {
  return [
    revisionBaseField,
    diffField,
    diffTheme,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged && !update.transactions.some((tr) => tr.effects.some((e) => e.is(setRevisionBase)))) {
        return
      }
      notifyDiffChanged()
    })
  ]
}
