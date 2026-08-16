/**
 * `j` / `k` (and `+`, `-`, `_`) moving by DOCUMENT line rather than by
 * rendered geometry.
 *
 * The engine's own `moveByLines` computes the target document line, then walks
 * the same distance through screen coordinates with `cm.findPosV` and, if that
 * walk lands further than the document line did, adopts it — the `hasMarkedText`
 * branch, written for CM5's collapsed ranges.
 *
 * Under reading mode that branch misfires. An image is a block replace
 * decoration covering its whole line, so the coordinate walk clears the entire
 * widget in a single step and vim takes that position instead. The image's own
 * line — and, when the widget is tall, the line under it — become unreachable,
 * which also means the source they hide can never be revealed for editing.
 * Every line has to be reachable for reading mode to stay editable.
 *
 * Dropping the adoption is also nearer to real vim, where `j` is a document-line
 * motion; `gj` is the display-line one and is deliberately left alone, as are
 * `<C-f>`/`<C-b>`, which ask `findPosV` for pages rather than lines.
 *
 * Free of any CodeMirror import so the motion is testable in node — apps/desktop
 * has no jsdom, and the whole point of this module is the arithmetic.
 */

export interface VimPos {
  line: number
  ch: number
}

export interface VimMotionArgs {
  forward?: boolean
  repeat: number
  repeatOffset?: number
  toFirstChar?: boolean
}

/** The mutable per-editor vim state this motion reads and updates. */
export interface VimMotionState {
  lastMotion: unknown
  lastHPos: number
  lastHSPos: number
}

/** The part of the engine's CM5 adapter this motion uses. */
export interface MotionCm {
  firstLine: () => number
  lastLine: () => number
  getLine: (line: number) => string
  charCoords: (pos: VimPos, mode: string) => { left: number }
}

/**
 * `motions`, the object the engine invokes the motion on. The five identity
 * comparisons below are how vim decides whether the previous motion was a
 * vertical one whose remembered column this move should keep.
 */
export interface MotionsHost {
  moveByLines: unknown
  moveByDisplayLines: unknown
  moveByScroll: unknown
  moveToColumn: unknown
  moveToEol: unknown
  moveToStartOfLine: (
    cm: MotionCm,
    head: VimPos,
    motionArgs: VimMotionArgs,
    vim: VimMotionState
  ) => VimPos
}

/** CM5's `findFirstNonWhiteSpaceCharacter`: a whitespace-only line yields 0. */
export function firstNonWhitespace(text: string): number {
  return Math.max(0, text.search(/\S/))
}

export function moveByDocumentLines(
  this: MotionsHost,
  cm: MotionCm,
  head: VimPos,
  motionArgs: VimMotionArgs,
  vim: VimMotionState
): VimPos {
  let endCh = head.ch
  switch (vim.lastMotion) {
    case this.moveByLines:
    case this.moveByDisplayLines:
    case this.moveByScroll:
    case this.moveToColumn:
    case this.moveToEol:
      endCh = vim.lastHPos
      break
    default:
      vim.lastHPos = endCh
  }

  const repeat = motionArgs.repeat + (motionArgs.repeatOffset ?? 0)
  const line = motionArgs.forward === true ? head.line + repeat : head.line - repeat
  const first = cm.firstLine()
  const last = cm.lastLine()

  // Already on the first/last line and moving further off the end: vim goes to
  // the start/end of that line instead of refusing to move.
  if (line < first && head.line === first) {
    return this.moveToStartOfLine(cm, head, motionArgs, vim)
  }
  if (line > last && head.line === last) {
    // The engine reaches its own moveToEol with keepHPos here, which leaves
    // lastHPos/lastHSPos untouched so a following j/k still knows the column.
    return { line: head.line + repeat - 1, ch: Infinity }
  }

  if (motionArgs.toFirstChar === true) {
    endCh = firstNonWhitespace(cm.getLine(line))
    vim.lastHPos = endCh
  }
  vim.lastHSPos = cm.charCoords({ line, ch: endCh }, 'div').left
  return { line, ch: endCh }
}

