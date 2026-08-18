import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import {
  insertCitationEffect,
  insertCrossReferenceEffect,
  insertFigureEmbedEffect,
  insertLinkEffect,
  toggleWrapEffect,
  wordBoundsAt
} from './markdownCommands'

function stateOf(doc: string, from: number, to = from): EditorState {
  return EditorState.create({ doc, selection: EditorSelection.single(from, to) })
}

/** Applies a toggleWrapEffect and returns the resulting doc + selection, or
 *  null passed straight through when the effect itself is a no-op. */
function applyToggle(doc: string, from: number, to: number, marker: string) {
  const state = stateOf(doc, from, to)
  const spec = toggleWrapEffect(state, marker)
  expect(spec).not.toBeNull()
  const next = state.update(spec!).state
  return {
    doc: next.doc.toString(),
    from: next.selection.main.from,
    to: next.selection.main.to
  }
}

describe('toggleWrapEffect — no selection (word under cursor)', () => {
  it('wraps the word the cursor sits inside', () => {
    // cursor in the middle of "hello"
    const out = applyToggle('say hello world', 6, 6, '**')
    expect(out.doc).toBe('say **hello** world')
  })

  it('unwraps when the cursor sits inside an already-wrapped word', () => {
    const out = applyToggle('say **hello** world', 8, 8, '**')
    expect(out.doc).toBe('say hello world')
  })

  it('cursor adjacent to no word char wraps an empty pair with the caret between the marks', () => {
    const out = applyToggle('a  b', 2, 2, '**')
    expect(out.doc).toBe('a **** b')
    expect(out.from).toBe(out.to)
    expect(out.doc.slice(out.from - 2, out.from)).toBe('**')
    expect(out.doc.slice(out.from, out.from + 2)).toBe('**')
  })

  it('cursor at the very start of an empty document does not crash', () => {
    const out = applyToggle('', 0, 0, '**')
    expect(out.doc).toBe('****')
    expect(out.from).toBe(2)
    expect(out.to).toBe(2)
  })
})

describe('toggleWrapEffect — already wrapped selection unwraps', () => {
  it('unwraps when the selection is exactly the inner text (markers outside selection)', () => {
    const out = applyToggle('**bold**', 2, 6, '**')
    expect(out.doc).toBe('bold')
    expect(out.doc.slice(out.from, out.to)).toBe('bold')
  })

  it('unwraps when the selection includes the markers themselves', () => {
    const out = applyToggle('**bold**', 0, 8, '**')
    expect(out.doc).toBe('bold')
    expect(out.doc.slice(out.from, out.to)).toBe('bold')
  })

  it('round-trips: wrap then unwrap returns the original text', () => {
    const wrapped = applyToggle('word', 0, 4, '**')
    expect(wrapped.doc).toBe('**word**')
    const back = applyToggle(wrapped.doc, wrapped.from, wrapped.to, '**')
    expect(back.doc).toBe('word')
  })
})

describe('toggleWrapEffect — partial overlap normalizes to a clean toggle', () => {
  // A selection that only partially overlaps an existing pair's markers is
  // still "inside" that pair, so the toggle removes the WHOLE enclosing
  // span rather than patching around just the selected text — the only
  // choice that can never leave a dangling/unmatched delimiter behind.

  it('selecting a prefix that includes only the opening marker unwraps the whole span', () => {
    // "**bold**", select "bo" (just past the opening **, not reaching the close)
    const out = applyToggle('**bold**', 2, 4, '**')
    expect(out.doc).toBe('bold')
    expect(out.doc).not.toMatch(/\*/) // no leftover/dangling marker characters
    expect(out.doc.slice(out.from, out.to)).toBe('bo') // the originally-selected text stays selected
  })

  it('selecting a suffix that includes only the closing marker unwraps the whole span', () => {
    // "**bold**", select "ld**" (reaches the close, not the open)
    const out = applyToggle('**bold**', 4, 8, '**')
    expect(out.doc).toBe('bold')
    expect(out.doc).not.toMatch(/\*/)
    expect(out.doc.slice(out.from, out.to)).toBe('ld')
  })

  it('selecting a strict inner subset of an existing span unwraps the whole span', () => {
    // "**word**", select "or" (middle of the bolded word, no markers touching)
    const out = applyToggle('**word**', 3, 5, '**')
    expect(out.doc).toBe('word')
    expect(out.doc).not.toMatch(/\*/)
    expect(out.doc.slice(out.from, out.to)).toBe('or')
  })

  it('a selection reaching past the enclosing pair on one side is left as a plain wrap (never strips a lone marker)', () => {
    // "**bold** rest" — select "old** r" (crosses the closing marker without
    // being fully contained by the pair): no enclosing pair contains it, so
    // it's wrapped as-is (a fresh pair around exactly the selection) rather
    // than risking an orphaned delimiter by stripping only one side.
    const doc = '**bold** rest'
    const out = applyToggle(doc, 3, 10, '**')
    expect(out.doc).toBe('**b' + '**' + 'old** r' + '**' + 'est')
    // greedy non-overlapping "**" tokens always pair up evenly — nothing dangling
    expect((out.doc.match(/\*\*/g) ?? []).length % 2).toBe(0)
  })
})

describe('toggleWrapEffect — multi-line selection wraps per line', () => {
  it('wraps each line of a multi-line selection independently, not across the newlines', () => {
    const out = applyToggle('one\ntwo\nthree', 0, 13, '**')
    expect(out.doc).toBe('**one**\n**two**\n**three**')
  })

  it('unwraps each already-wrapped line independently', () => {
    const doc = '**one**\n**two**\n**three**'
    const out = applyToggle(doc, 0, doc.length, '**')
    expect(out.doc).toBe('one\ntwo\nthree')
  })

  it('a blank line inside the selection is left untouched (no stray markers)', () => {
    const out = applyToggle('one\n\ntwo', 0, 8, '**')
    expect(out.doc).toBe('**one**\n\n**two**')
  })
})

describe('toggleWrapEffect — edges do not crash', () => {
  it('selection touching both ends of the document', () => {
    const out = applyToggle('hi', 0, 2, '`')
    expect(out.doc).toBe('`hi`')
  })

  it('empty document, no selection', () => {
    const state = stateOf('', 0, 0)
    const spec = toggleWrapEffect(state, '~~')
    expect(spec).not.toBeNull()
    expect(() => state.update(spec!).state).not.toThrow()
  })

  it('single-character document, cursor at position 1 (doc end)', () => {
    const out = applyToggle('x', 1, 1, '*')
    expect(out.doc).toBe('*x*')
  })
})

describe('toggleWrapEffect — markers besides bold', () => {
  it('italic marker "*"', () => {
    const out = applyToggle('word', 0, 4, '*')
    expect(out.doc).toBe('*word*')
  })

  it('code marker "`"', () => {
    const out = applyToggle('word', 0, 4, '`')
    expect(out.doc).toBe('`word`')
  })

  it('strikethrough marker "~~"', () => {
    const out = applyToggle('word', 0, 4, '~~')
    expect(out.doc).toBe('~~word~~')
  })
})

describe('wordBoundsAt', () => {
  it('finds the word run touching the cursor from either side', () => {
    const s = EditorState.create({ doc: 'hello world' })
    expect(wordBoundsAt(s, 2)).toEqual({ from: 0, to: 5 }) // cursor inside "hello"
    expect(wordBoundsAt(s, 5)).toEqual({ from: 0, to: 5 }) // cursor right after "hello"
    expect(wordBoundsAt(s, 6)).toEqual({ from: 6, to: 11 }) // cursor right before "world"
  })

  it('returns an empty range when no word character is adjacent', () => {
    const s = EditorState.create({ doc: 'a   b' })
    expect(wordBoundsAt(s, 2)).toEqual({ from: 2, to: 2 })
  })
})

describe('insertLinkEffect', () => {
  it('wraps a selection as link text and selects the url placeholder', () => {
    const state = stateOf('see docs here', 4, 8) // "docs"
    const next = state.update(insertLinkEffect(state)).state
    expect(next.doc.toString()).toBe('see [docs](url) here')
    expect(next.doc.sliceString(next.selection.main.from, next.selection.main.to)).toBe('url')
  })

  it('empty selection inserts [](url) with the placeholder selected', () => {
    const state = stateOf('go here', 3, 3) // cursor right before "here"
    const next = state.update(insertLinkEffect(state)).state
    expect(next.doc.toString()).toBe('go [](url)here')
    expect(next.doc.sliceString(next.selection.main.from, next.selection.main.to)).toBe('url')
  })
})

describe('insertCitationEffect', () => {
  it('inserts [@key] at the cursor', () => {
    const state = stateOf('as shown\n', 8, 8)
    const next = state.update(insertCitationEffect(state, 'smith2020')).state
    expect(next.doc.toString()).toBe('as shown[@smith2020]\n')
  })

  it('replaces a selection with [@key]', () => {
    const state = stateOf('cite HERE please', 5, 9)
    const next = state.update(insertCitationEffect(state, 'doe2019')).state
    expect(next.doc.toString()).toBe('cite [@doe2019] please')
  })
})

describe('insertCrossReferenceEffect', () => {
  const apply = (doc: string, from: number, to = from): string => {
    const state = stateOf(doc, from, to)
    return state.update(insertCrossReferenceEffect(state, 'fig-spectrum')).state.doc.toString()
  }

  it('inserts @fig:id after a space', () => {
    expect(apply('as shown in ', 12)).toBe('as shown in @fig:fig-spectrum')
  })

  it('inserts at the very start of the document without a leading space', () => {
    expect(apply('rest', 0)).toBe('@fig:fig-spectrumrest')
  })

  it('inserts after an opening bracket without a leading space — "(@fig:x)" parses', () => {
    expect(apply('see (', 5)).toBe('see (@fig:fig-spectrum')
  })

  /**
   * The parser only recognises a bare `@kind:id` at the start of a line or
   * after whitespace/`([{`. Without this space the inserted text would look
   * like a reference and render as prose.
   */
  it('adds the space the grammar needs when the cursor sits against a word', () => {
    expect(apply('word', 4)).toBe('word @fig:fig-spectrum')
  })

  it('replaces a selection', () => {
    expect(apply('see THAT here', 4, 8)).toBe('see @fig:fig-spectrum here')
  })
})

describe('insertFigureEmbedEffect', () => {
  const apply = (doc: string, from: number, to = from) => {
    const state = stateOf(doc, from, to)
    const next = state.update(insertFigureEmbedEffect(state, 'fig-spectrum')).state
    return { doc: next.doc.toString(), cursor: next.selection.main.head }
  }

  it('splits a paragraph so the embed is a paragraph of its own', () => {
    // `![[fig:id]]` is only an embed when it is a paragraph containing
    // nothing else, so a mid-paragraph insert needs a blank line either side.
    expect(apply('abc def', 4).doc).toBe('abc \n\n![[fig:fig-spectrum]]\n\ndef')
  })

  it('adds no padding at all on a blank line between paragraphs', () => {
    expect(apply('one\n\n\n\ntwo', 5).doc).toBe('one\n\n![[fig:fig-spectrum]]\n\ntwo')
  })

  it('adds the missing blank line when only the line above has text', () => {
    // cursor on the trailing empty line: nothing follows, so only the top
    // side needs separating
    expect(apply('one\n', 4).doc).toBe('one\n\n![[fig:fig-spectrum]]')
  })

  it('adds the missing blank line when only the line below has text', () => {
    // at the very start nothing above needs separating; the one added \n
    // joins the document's own to make the blank line below
    expect(apply('\ntwo', 0).doc).toBe('![[fig:fig-spectrum]]\n\ntwo')
  })

  it('separates both sides on a lone empty line between two paragraphs', () => {
    // 'one\n\ntwo' has ONE empty line: the embed needs a blank line above
    // and below, so both are added
    expect(apply('one\n\ntwo', 4).doc).toBe('one\n\n![[fig:fig-spectrum]]\n\ntwo')
  })

  it('separates both sides at the end of a paragraph', () => {
    expect(apply('one\n\ntwo', 3).doc).toBe('one\n\n![[fig:fig-spectrum]]\n\ntwo')
  })

  it('needs no padding in an empty document', () => {
    expect(apply('', 0).doc).toBe('![[fig:fig-spectrum]]')
  })

  it('replaces a selection', () => {
    expect(apply('one\n\nDROP\n\ntwo', 5, 9).doc).toBe('one\n\n![[fig:fig-spectrum]]\n\ntwo')
  })

  /** Typing on the embed's own line would turn it back into plain text. */
  it('leaves the cursor on the blank line below the embed, ready for prose', () => {
    const { doc, cursor } = apply('abc def', 4)
    expect(doc.slice(0, cursor)).toBe('abc \n\n![[fig:fig-spectrum]]\n')
    expect(doc.slice(cursor)).toBe('\ndef')
  })

  it('leaves the cursor below the embed when the blank line was already there', () => {
    const { doc, cursor } = apply('one\n\n\n\ntwo', 5)
    expect(doc.slice(0, cursor)).toBe('one\n\n![[fig:fig-spectrum]]\n')
  })

  it('leaves the cursor at the end when the embed ends the document', () => {
    const { doc, cursor } = apply('', 0)
    expect(cursor).toBe(doc.length)
  })
})
