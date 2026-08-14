import { describe, expect, it } from 'vitest'
import { StringStream } from '@codemirror/language'
import {
  bibCompletion,
  bibDiagnostics,
  bibStreamParser,
  insideEntryBody,
  scanEntries
} from './bibLang'

const ARTICLE = `@article{smith2020,
  author = {Smith, Jane},
  title = {A Study},
  journal = {Journal of Things},
  year = {2020}
}
`

describe('scanEntries', () => {
  it('reads type, key and top-level field names', () => {
    const entries = scanEntries(ARTICLE)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry?.type).toBe('article')
    expect(entry?.key).toBe('smith2020')
    expect([...(entry?.fields ?? [])].sort()).toEqual(['author', 'journal', 'title', 'year'])
    expect(ARTICLE.slice(entry?.keyFrom, entry?.keyTo)).toBe('smith2020')
  })

  it('does not mistake braced content for fields or entry starts', () => {
    const source = '@misc{a,\n  title = {An @article{trap, x = 1} inside}\n}\n'
    const entries = scanEntries(source)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.key).toBe('a')
    expect([...(entries[0]?.fields ?? [])]).toEqual(['title'])
  })

  it('ignores @string, @preamble and @comment directives', () => {
    const source = '@string{jt = {Journal of Things}}\n\n@misc{a, title = {T}}\n'
    expect(scanEntries(source).map((e) => e.key)).toEqual(['a'])
  })

  it('handles quoted field values containing braces', () => {
    const entries = scanEntries('@misc{a, title = "a } brace", note = {n}}\n')
    expect([...(entries[0]?.fields ?? [])].sort()).toEqual(['note', 'title'])
  })

  it('reads several entries and their offsets', () => {
    const source = `${ARTICLE}\n@book{doe1999,\n  title = {T}\n}\n`
    const entries = scanEntries(source)
    expect(entries.map((e) => e.key)).toEqual(['smith2020', 'doe1999'])
    expect(source.slice(entries[1]!.from, entries[1]!.from + 5)).toBe('@book')
  })

  it('recovers on an unterminated entry', () => {
    const entries = scanEntries('@misc{a,\n  title = {T}\n')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.key).toBe('a')
  })
})

describe('bibDiagnostics', () => {
  it('accepts a complete article', () => {
    expect(bibDiagnostics(ARTICLE)).toEqual([])
  })

  it('flags missing required fields for an article', () => {
    const source = '@article{a,\n  title = {T}\n}\n'
    const diagnostics = bibDiagnostics(source)
    const missing = diagnostics.find((d) => d.message.includes('missing required'))
    expect(missing?.severity).toBe('warning')
    expect(missing?.message).toContain('author')
    expect(missing?.message).toContain('journal')
    expect(missing?.message).toContain('year')
    // pinned to the header line, not the whole entry
    expect(source.slice(missing?.from, missing?.to)).toBe('@article{a,')
  })

  it('uses per-type required fields', () => {
    const book = bibDiagnostics('@book{a,\n  author = {A},\n  title = {T},\n  year = {1}\n}\n')
    expect(book[0]?.message).toContain('publisher')
    const proc = bibDiagnostics(
      '@inproceedings{a,\n  author = {A},\n  title = {T},\n  year = {1}\n}\n'
    )
    expect(proc[0]?.message).toContain('booktitle')
    expect(bibDiagnostics('@misc{a,\n  title = {T}\n}\n')).toEqual([])
    expect(bibDiagnostics('@misc{a,\n  note = {N}\n}\n')[0]?.message).toContain('title')
  })

  it('does not check types without a required-field rule', () => {
    expect(bibDiagnostics('@techreport{a,\n  note = {N}\n}\n')).toEqual([])
  })

  it('flags duplicate citation keys and points at the repeat', () => {
    const source = `${ARTICLE}\n@article{smith2020,\n  author = {A},\n  title = {T},\n  journal = {J},\n  year = {2021}\n}\n`
    const duplicate = bibDiagnostics(source).find((d) => d.message.includes('duplicate'))
    expect(duplicate?.severity).toBe('error')
    expect(duplicate?.message).toContain('line 1')
    expect(source.slice(duplicate?.from, duplicate?.to)).toBe('smith2020')
    // the first definition is not flagged
    expect(duplicate!.from).toBeGreaterThan(ARTICLE.length)
  })

  it('reports parse errors from @suna/bib', () => {
    const diagnostics = bibDiagnostics('@article{,\n  title = {T}\n}\n')
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })

  it('returns diagnostics sorted by position', () => {
    const source = '@article{b,\n  title = {T}\n}\n\n@book{c,\n  title = {T}\n}\n'
    const diagnostics = bibDiagnostics(source)
    expect(diagnostics.length).toBe(2)
    expect(diagnostics[0]!.from).toBeLessThan(diagnostics[1]!.from)
  })

  it('handles an empty document', () => {
    expect(bibDiagnostics('')).toEqual([])
  })
})

describe('bib stream tokenizer', () => {
  /** Token names produced for one line, given a fresh parser state. */
  function tokensFor(line: string): (string | null)[] {
    const state = bibStreamParser.startState()
    const stream = new StringStream(line, 2, 2)
    const out: (string | null)[] = []
    let guard = 0
    while (!stream.eol() && guard < 200) {
      stream.start = stream.pos
      out.push(bibStreamParser.token(stream, state))
      guard += 1
    }
    return out
  }

  it('marks the entry type as a keyword and the key as a label', () => {
    expect(tokensFor('@article{smith2020,')).toEqual(['keyword', null, 'labelName', null])
  })

  it('marks field names and braced values', () => {
    const state = bibStreamParser.startState()
    const head = new StringStream('@misc{a,', 2, 2)
    while (!head.eol()) {
      head.start = head.pos
      bibStreamParser.token(head, state)
    }
    const stream = new StringStream('  title = {T}', 2, 2)
    const out: (string | null)[] = []
    while (!stream.eol()) {
      stream.start = stream.pos
      out.push(bibStreamParser.token(stream, state))
    }
    expect(out).toContain('propertyName')
    expect(out).toContain('operator')
    expect(out).toContain('string')
  })

  it('treats text between entries as comment', () => {
    expect(tokensFor('% a note')).toEqual(['comment'])
  })
})

describe('bibCompletion', () => {
  function contextFor(doc: string, pos: number, explicit = false): Parameters<typeof bibCompletion>[0] {
    return {
      pos,
      explicit,
      state: { doc: { toString: () => doc } },
      matchBefore: (expr: RegExp) => {
        const before = doc.slice(0, pos)
        const match = new RegExp(`(?:${expr.source})$`).exec(before)
        if (match === null) return null
        return { from: pos - match[0].length, to: pos, text: match[0] }
      }
    }
  }

  it('offers entry types after @', () => {
    const doc = '@art'
    const result = bibCompletion(contextFor(doc, doc.length))
    expect(result?.from).toBe(1)
    expect(result?.options.map((o) => o.label)).toContain('article')
  })

  it('offers field names inside an entry body', () => {
    const doc = '@article{a,\n  jour'
    const result = bibCompletion(contextFor(doc, doc.length))
    expect(result?.options.map((o) => o.label)).toContain('journal')
    expect(result?.from).toBe(doc.length - 4)
  })

  it('offers nothing outside an entry', () => {
    const doc = 'loose text'
    expect(bibCompletion(contextFor(doc, doc.length))).toBeNull()
  })

  it('knows when a position is inside an entry body', () => {
    const doc = '@misc{a, title = {T}}\nafter'
    expect(insideEntryBody(doc, doc.indexOf('title'))).toBe(true)
    expect(insideEntryBody(doc, doc.indexOf('after'))).toBe(false)
  })
})
