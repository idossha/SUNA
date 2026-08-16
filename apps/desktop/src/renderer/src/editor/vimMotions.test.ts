import { describe, expect, it } from 'vitest'
import {
  firstNonWhitespace,
  moveByDocumentLines,
  type MotionCm,
  type MotionsHost,
  type VimMotionState,
  type VimPos
} from './vimMotions'

const DOC = [
  'Electrode localization is registered to the T1.', // 0
  '', // 1
  '![CT-to-T1 registration](../figures/fig1.png)', // 2 — a block widget in reading mode
  '', // 3
  '**Figure 1.** CT-to-T1 registration.', // 4
  '  indented caption continuation' // 5
]

function cm(lines: string[] = DOC): MotionCm {
  return {
    firstLine: () => 0,
    lastLine: () => lines.length - 1,
    getLine: (line) => lines[line] ?? '',
    charCoords: (pos) => ({ left: pos.ch * 8 })
  }
}

/**
 * Stands in for the engine's `motions` object as it looks AFTER installation —
 * `defineMotion('moveByLines', …)` replaces the entry, so `motions.moveByLines`
 * is this very function, which is how a repeated `j` recognises the previous
 * motion as vertical. The other four are only compared by identity, so unique
 * sentinels are enough; moveToStartOfLine is the one that actually gets called.
 */
function host(): MotionsHost {
  return {
    moveByLines: moveByDocumentLines,
    moveByDisplayLines: Symbol('moveByDisplayLines'),
    moveByScroll: Symbol('moveByScroll'),
    moveToColumn: Symbol('moveToColumn'),
    moveToEol: Symbol('moveToEol'),
    moveToStartOfLine: () => ({ line: 0, ch: 0 })
  }
}

function state(over: Partial<VimMotionState> = {}): VimMotionState {
  return { lastMotion: null, lastHPos: 0, lastHSPos: 0, ...over }
}

function down(from: VimPos, vim: VimMotionState, h = host(), repeat = 1): VimPos {
  return moveByDocumentLines.call(h, cm(), from, { forward: true, repeat }, vim)
}

describe('moveByDocumentLines', () => {
  it('steps onto the line a block widget covers instead of clearing it', () => {
    // The reported bug: j from line 1 jumped straight past the image. Line 2 is
    // the image's source and must be reachable, or it can never be edited.
    expect(down({ line: 1, ch: 0 }, state()).line).toBe(2)
  })

  it('steps off a block-widget line onto the very next line', () => {
    expect(down({ line: 2, ch: 0 }, state()).line).toBe(3)
  })

  it('walks every line of a figure block in order, skipping none', () => {
    const h = host()
    const vim = state()
    const seen: number[] = []
    let pos: VimPos = { line: 0, ch: 0 }
    for (let i = 0; i < 5; i += 1) {
      pos = down(pos, vim, h)
      vim.lastMotion = moveByDocumentLines
      seen.push(pos.line)
    }
    expect(seen).toEqual([1, 2, 3, 4, 5])
  })

  it('k walks back up through the block widget one line at a time', () => {
    const h = host()
    const vim = state()
    const seen: number[] = []
    let pos: VimPos = { line: 5, ch: 0 }
    for (let i = 0; i < 5; i += 1) {
      pos = moveByDocumentLines.call(h, cm(), pos, { forward: false, repeat: 1 }, vim)
      vim.lastMotion = moveByDocumentLines
      seen.push(pos.line)
    }
    expect(seen).toEqual([4, 3, 2, 1, 0])
  })

  it('honours a count', () => {
    expect(down({ line: 0, ch: 0 }, state(), host(), 3).line).toBe(3)
  })

  it('remembers the column across a run of vertical moves', () => {
    const h = host()
    const vim = state()
    const first = moveByDocumentLines.call(h, cm(), { line: 0, ch: 30 }, { forward: true, repeat: 1 }, vim)
    expect(vim.lastHPos).toBe(30)
    // A second j reports the previous motion as this one, so the remembered
    // column is reused rather than being reset to the (empty) line's ch.
    vim.lastMotion = moveByDocumentLines
    const second = moveByDocumentLines.call(h, cm(), { line: first.line, ch: 0 }, { forward: true, repeat: 1 }, vim)
    expect(second.ch).toBe(30)
  })

  it('adopts the column of a preceding horizontal motion', () => {
    const h = host()
    const vim = state({ lastMotion: Symbol('moveByWords'), lastHPos: 99 })
    expect(down({ line: 0, ch: 4 }, vim, h).ch).toBe(4)
    expect(vim.lastHPos).toBe(4)
  })

  it('goes to the start of the document when k runs off the top', () => {
    const h = host()
    const result = moveByDocumentLines.call(h, cm(), { line: 0, ch: 12 }, { forward: false, repeat: 1 }, state())
    expect(result).toEqual({ line: 0, ch: 0 })
  })

  it('goes to end-of-line when j runs off the bottom', () => {
    const result = down({ line: 5, ch: 2 }, state())
    expect(result).toEqual({ line: 5, ch: Infinity })
  })

  it('lands on the first non-blank for + / - / _', () => {
    const h = host()
    const vim = state()
    const result = moveByDocumentLines.call(
      h,
      cm(),
      { line: 4, ch: 0 },
      { forward: true, repeat: 1, toFirstChar: true },
      vim
    )
    expect(result).toEqual({ line: 5, ch: 2 })
    expect(vim.lastHPos).toBe(2)
  })

  it('applies repeatOffset, so _ stays on its own line', () => {
    const result = moveByDocumentLines.call(
      host(),
      cm(),
      { line: 4, ch: 0 },
      { forward: true, repeat: 1, repeatOffset: -1, toFirstChar: true },
      state()
    )
    expect(result.line).toBe(4)
  })
})

describe('firstNonWhitespace', () => {
  it('finds the first non-blank column', () => {
    expect(firstNonWhitespace('   text')).toBe(3)
    expect(firstNonWhitespace('text')).toBe(0)
  })

  it('returns 0 for a blank or whitespace-only line rather than -1', () => {
    expect(firstNonWhitespace('')).toBe(0)
    expect(firstNonWhitespace('    ')).toBe(0)
  })
})
