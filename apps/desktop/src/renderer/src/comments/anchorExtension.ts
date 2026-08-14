import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view'
import type { Comment } from '@suna/core'
import { locate } from './anchor'

/**
 * CodeMirror extension powering the manuscript editor's comment-anchor UI:
 * a subtle highlight on every anchored range, a small dot at the start of
 * each anchored line, and Cmd/Ctrl-Shift-M to start a comment on the
 * current selection.
 *
 * Appended to an already-created EditorView via `StateEffect.appendConfig`
 * (see manuscript/SectionEditor.tsx) rather than threaded through
 * editor/codemirror.ts's CreateEditorOptions — that keeps this feature's
 * footprint inside comments/** plus one small SectionEditor.tsx hook, per
 * the "gutter dot ONLY, keep the diff small" instruction.
 *
 * Note on the "gutter" wording: the combined manuscript tab hides
 * CodeMirror's real `.cm-gutters` column in reading mode (manuscript.css:
 * `.msdoc .msdoc__editor .cm-gutters { display: none }`, since section
 * editors there render as document prose, not code). Re-enabling that
 * container for one custom gutter would also have to fight the container's
 * own default padding/border for every section editor, which is a bigger
 * footprint than this feature needs. Instead the "dot" is a `Decoration.line`
 * class (`cmt-line-dot`) whose `::before` sits just left of the text — same
 * visual result, zero changes outside comments/** and this file's one hook.
 */

function resolvedRanges(
  text: string,
  comments: readonly Comment[]
): Array<{ comment: Comment; from: number; to: number }> {
  const out: Array<{ comment: Comment; from: number; to: number }> = []
  for (const comment of comments) {
    if (comment.target.kind !== 'section') continue
    const range = locate(text, comment.target.anchor)
    if (range === null || range.from >= range.to) continue
    out.push({ comment, from: range.from, to: range.to })
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to)
}

/** Effect: replace the set of comments this editor's decorations track. */
export const setSectionComments = StateEffect.define<readonly Comment[]>()

const commentsField = StateField.define<readonly Comment[]>({
  create: () => [],
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setSectionComments)) value = effect.value
    }
    return value
  }
})

const anchorMark = Decoration.mark({ class: 'cmt-anchor' })
const lineDotMark = Decoration.line({ class: 'cmt-line-dot' })

function rebuild(text: string, comments: readonly Comment[]): DecorationSet {
  const entries = resolvedRanges(text, comments)
  const builder = new RangeSetBuilder<Decoration>()
  for (const entry of entries) builder.add(entry.from, entry.to, anchorMark)
  return builder.finish()
}

const decorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    const wasSet = tr.effects.some((effect) => effect.is(setSectionComments))
    if (!tr.docChanged && !wasSet) return deco
    return rebuild(tr.state.doc.toString(), tr.state.field(commentsField))
  },
  provide: (field) => EditorView.decorations.from(field)
})

function rebuildLineDots(state: { doc: { toString(): string; lineAt(pos: number): { from: number } } }, comments: readonly Comment[]): DecorationSet {
  const text = state.doc.toString()
  const entries = resolvedRanges(text, comments)
  const lineStarts = [...new Set(entries.map((entry) => state.doc.lineAt(entry.from).from))].sort(
    (a, b) => a - b
  )
  const builder = new RangeSetBuilder<Decoration>()
  for (const from of lineStarts) builder.add(from, from, lineDotMark)
  return builder.finish()
}

const lineDotsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    const wasSet = tr.effects.some((effect) => effect.is(setSectionComments))
    if (!tr.docChanged && !wasSet) return deco.map(tr.changes)
    return rebuildLineDots(tr.state, tr.state.field(commentsField))
  },
  provide: (field) => EditorView.decorations.from(field)
})

/** Effect: briefly highlight one range (comment-panel "scroll to and flash"). */
export const setFlashRange = StateEffect.define<{ from: number; to: number } | null>()

const flashField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setFlashRange)) value = effect.value
    }
    if (value !== null && tr.docChanged) value = null
    return value
  }
})

const flashMark = Decoration.mark({ class: 'cmt-anchor--flash' })

const flashDecorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (_deco, tr) => {
    const flash = tr.state.field(flashField)
    return flash === null ? Decoration.none : Decoration.set([flashMark.range(flash.from, flash.to)])
  },
  provide: (field) => EditorView.decorations.from(field)
})

/**
 * Builds the extension. `onRequestComment` fires with the live selection's
 * [from, to) when Mod-Shift-M is pressed over a non-empty selection.
 */
export function commentAnchorExtension(onRequestComment: (from: number, to: number) => void): Extension {
  return [
    commentsField,
    decorationsField,
    lineDotsField,
    flashField,
    flashDecorationField,
    keymap.of([
      {
        key: 'Mod-Shift-m',
        run: (view) => {
          const { from, to } = view.state.selection.main
          if (from === to) return false
          onRequestComment(from, to)
          return true
        }
      }
    ])
  ]
}

/** Push a fresh comments list into a view that already has the extension appended. */
export function applySectionComments(view: EditorView, comments: readonly Comment[]): void {
  view.dispatch({ effects: setSectionComments.of(comments) })
}

/** Select, scroll to, and briefly highlight an anchored range. */
export function flashAnchor(view: EditorView, from: number, to: number): void {
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: [setFlashRange.of({ from, to }), EditorView.scrollIntoView(from, { y: 'center' })]
  })
  window.setTimeout(() => {
    view.dispatch({ effects: setFlashRange.of(null) })
  }, 1200)
}
