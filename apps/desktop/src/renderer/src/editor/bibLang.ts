import { StreamLanguage, type StringStream } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import type { Diagnostic } from '@codemirror/lint'
import type { EditorView } from '@codemirror/view'
import { parseBibtex } from '@suna/bib'

/* ---------------------------------------------------------------------------
   A small language pack for .bib: stream highlighting, diagnostics, and a
   completion source. Everything below the CodeMirror wiring is pure text ->
   data so it can be tested without a DOM.
   ------------------------------------------------------------------------- */

/** Entry types offered after `@` and used to pick required fields. */
export const BIB_ENTRY_TYPES: readonly string[] = [
  'article',
  'book',
  'booklet',
  'inbook',
  'incollection',
  'inproceedings',
  'conference',
  'manual',
  'mastersthesis',
  'misc',
  'phdthesis',
  'proceedings',
  'techreport',
  'unpublished'
]

/** Field names offered inside an entry body. */
export const BIB_FIELDS: readonly string[] = [
  'address',
  'annote',
  'archiveprefix',
  'author',
  'booktitle',
  'chapter',
  'doi',
  'edition',
  'editor',
  'eprint',
  'howpublished',
  'institution',
  'isbn',
  'issn',
  'journal',
  'keywords',
  'language',
  'month',
  'note',
  'number',
  'organization',
  'pages',
  'publisher',
  'school',
  'series',
  'title',
  'type',
  'url',
  'volume',
  'year'
]

/**
 * Required fields per entry type. Types absent from this map get no
 * completeness check — flagging fields BibTeX itself does not require would
 * be noise.
 */
export const REQUIRED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  article: ['author', 'title', 'journal', 'year'],
  book: ['author', 'title', 'publisher', 'year'],
  inproceedings: ['author', 'title', 'booktitle', 'year'],
  misc: ['title']
}

/** `@string`/`@preamble`/`@comment` are directives, not reference entries. */
const NON_ENTRY_TYPES = new Set(['string', 'preamble', 'comment'])

/* ---- entry scanning -------------------------------------------------------
   @suna/bib's parseBibtex gives normalized entries but no source positions,
   so diagnostics need their own brace-balanced scan to place ranges. The two
   are complementary: parseBibtex reports syntax errors, this reports
   structure (duplicate keys, missing fields) with exact offsets.
   ------------------------------------------------------------------------- */

export interface ScannedEntry {
  type: string
  key: string
  /** Offset of the leading `@`. */
  from: number
  /** Offset just past the closing delimiter. */
  to: number
  /** Offsets of the citation key token (equal when the key is absent). */
  keyFrom: number
  keyTo: number
  /** Lower-cased field names present at the top level of the entry body. */
  fields: Set<string>
}

const ENTRY_HEAD = /^@([A-Za-z]+)[ \t\r\n]*([{(])/

/** Offset of the delimiter matching the one at `open`, or -1 if unbalanced. */
function matchDelimiter(text: string, open: number): number {
  const openCh = text.charAt(open)
  const closeCh = openCh === '{' ? '}' : ')'
  let depth = 0
  let quoted = false
  for (let i = open; i < text.length; i += 1) {
    const ch = text.charAt(i)
    if (quoted) {
      if (ch === '"') quoted = false
      else if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
      continue
    }
    if (ch === '"' && depth === 1) quoted = true
    else if (ch === openCh || ch === '{') depth += 1
    else if (ch === closeCh || ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Top-level `name =` occurrences inside an entry body. */
function scanFields(body: string): Set<string> {
  const fields = new Set<string>()
  let depth = 0
  let quoted = false
  let i = 0
  while (i < body.length) {
    const ch = body.charAt(i)
    if (quoted) {
      if (ch === '"') quoted = false
      i += 1
      continue
    }
    if (ch === '"' && depth === 0) {
      quoted = true
      i += 1
      continue
    }
    if (ch === '{' || ch === '(') {
      depth += 1
      i += 1
      continue
    }
    if (ch === '}' || ch === ')') {
      depth -= 1
      i += 1
      continue
    }
    if (depth === 0 && /[A-Za-z]/.test(ch)) {
      let end = i
      while (end < body.length && /[\w-]/.test(body.charAt(end))) end += 1
      let probe = end
      while (probe < body.length && /\s/.test(body.charAt(probe))) probe += 1
      if (body.charAt(probe) === '=') fields.add(body.slice(i, end).toLowerCase())
      i = Math.max(end, i + 1)
      continue
    }
    i += 1
  }
  return fields
}

/** Pure structural scan of a .bib document. Exported for tests. */
export function scanEntries(text: string): ScannedEntry[] {
  const entries: ScannedEntry[] = []
  let i = 0
  while (i < text.length) {
    const at = text.indexOf('@', i)
    if (at < 0) break
    const head = ENTRY_HEAD.exec(text.slice(at, at + 64))
    const type = head?.[1]
    if (head === null || type === undefined) {
      i = at + 1
      continue
    }
    const openIdx = at + head[0].length - 1
    const closeIdx = matchDelimiter(text, openIdx)
    const end = closeIdx < 0 ? text.length : closeIdx + 1
    const bodyFrom = openIdx + 1
    const bodyTo = closeIdx < 0 ? text.length : closeIdx
    const body = text.slice(bodyFrom, bodyTo)

    if (NON_ENTRY_TYPES.has(type.toLowerCase())) {
      i = end
      continue
    }

    const comma = body.indexOf(',')
    const keyRaw = comma < 0 ? body : body.slice(0, comma)
    const leading = keyRaw.length - keyRaw.trimStart().length
    const key = keyRaw.trim()
    const keyFrom = bodyFrom + leading
    entries.push({
      type: type.toLowerCase(),
      key,
      from: at,
      to: end,
      keyFrom,
      keyTo: keyFrom + key.length,
      fields: scanFields(comma < 0 ? '' : body.slice(comma + 1))
    })
    i = end
  }
  return entries
}

/* ---- diagnostics ---------------------------------------------------------- */

/** Clamp a range to the line containing `from`, so a diagnostic on a long
 *  entry underlines its header line rather than the whole block. */
function headerLine(text: string, from: number): { from: number; to: number } {
  const start = text.lastIndexOf('\n', from - 1) + 1
  const nl = text.indexOf('\n', from)
  return { from: start, to: nl < 0 ? text.length : nl }
}

/**
 * Diagnostics for a .bib document: parse errors from @suna/bib, duplicate
 * citation keys, and missing required fields. Pure text -> array.
 */
export function bibDiagnostics(text: string): Diagnostic[] {
  const out: Diagnostic[] = []

  for (const issue of parseBibtex(text).errors) {
    const input = issue.input
    const at = input === undefined ? -1 : text.indexOf(input)
    const range = at < 0 ? headerLine(text, 0) : headerLine(text, at)
    out.push({ ...range, severity: 'error', source: 'bibtex', message: issue.message })
  }

  const entries = scanEntries(text)
  const seen = new Map<string, ScannedEntry>()
  for (const entry of entries) {
    if (entry.key.length === 0) continue
    const first = seen.get(entry.key)
    if (first === undefined) {
      seen.set(entry.key, entry)
      continue
    }
    const line = text.slice(0, first.keyFrom).split('\n').length
    out.push({
      from: entry.keyFrom,
      to: entry.keyTo,
      severity: 'error',
      source: 'bibtex',
      message: `duplicate citation key "${entry.key}" (first defined on line ${line})`
    })
  }

  for (const entry of entries) {
    const required = REQUIRED_FIELDS[entry.type]
    if (required === undefined) continue
    const missing = required.filter((field) => !entry.fields.has(field))
    if (missing.length === 0) continue
    out.push({
      ...headerLine(text, entry.from),
      severity: 'warning',
      source: 'bibtex',
      message: `@${entry.type} is missing required ${
        missing.length === 1 ? 'field' : 'fields'
      }: ${missing.join(', ')}`
    })
  }

  return out.sort((a, b) => a.from - b.from)
}

export function bibLinter(view: EditorView): Diagnostic[] {
  return bibDiagnostics(view.state.doc.toString())
}

/* ---- completion -----------------------------------------------------------
   @codemirror/autocomplete is not a resolvable direct dependency here, so the
   source is typed structurally and handed to CodeMirror as language data. It
   stays dormant until an `autocompletion()` extension is enabled.
   ------------------------------------------------------------------------- */

interface CompletionMatch {
  from: number
  to: number
  text: string
}

interface CompletionContextLike {
  pos: number
  explicit: boolean
  matchBefore: (expr: RegExp) => CompletionMatch | null
  state: { doc: { toString: () => string } }
}

export interface CompletionResultLike {
  from: number
  options: { label: string; type: string }[]
}

/** True when `pos` falls inside the body of some entry (i.e. after its `{`). */
export function insideEntryBody(text: string, pos: number): boolean {
  return scanEntries(text).some((entry) => pos > entry.keyFrom && pos < entry.to)
}

/** Entry types after `@`, field names inside an entry body. */
export function bibCompletion(context: CompletionContextLike): CompletionResultLike | null {
  const atToken = context.matchBefore(/@\w*/)
  if (atToken !== null) {
    return {
      from: atToken.from + 1,
      options: BIB_ENTRY_TYPES.map((label) => ({ label, type: 'keyword' }))
    }
  }
  const word = context.matchBefore(/\w*/)
  if (word === null || (word.from === word.to && !context.explicit)) return null
  if (!insideEntryBody(context.state.doc.toString(), word.from)) return null
  return {
    from: word.from,
    options: BIB_FIELDS.map((label) => ({ label, type: 'property' }))
  }
}

/* ---- stream highlighting -------------------------------------------------- */

interface BibStreamState {
  /** Brace depth inside the current entry; 0 means "between entries". */
  depth: number
  /** A `@type` was just seen and its opening delimiter is expected next. */
  afterAt: boolean
  /** The next token is the citation key. */
  expectKey: boolean
  /** We are past an `=` and before the next top-level comma. */
  inValue: boolean
}

function token(stream: StringStream, state: BibStreamState): string | null {
  if (stream.eatSpace()) return null

  if (state.depth === 0) {
    if (stream.peek() === '@') {
      stream.next()
      stream.eatWhile(/[A-Za-z]/)
      state.afterAt = true
      return 'keyword'
    }
    if (state.afterAt && (stream.peek() === '{' || stream.peek() === '(')) {
      stream.next()
      state.depth = 1
      state.afterAt = false
      state.expectKey = true
      state.inValue = false
      return null
    }
    // BibTeX ignores everything outside an entry.
    if (stream.eatWhile(/[^@]/)) return 'comment'
    stream.next()
    return 'comment'
  }

  const ch = stream.peek()

  if (ch === '}' || ch === ')') {
    stream.next()
    state.depth -= 1
    if (state.depth <= 0) {
      state.depth = 0
      state.expectKey = false
      state.inValue = false
      return null
    }
    return 'string'
  }
  if (ch === '{') {
    stream.next()
    state.depth += 1
    return state.depth >= 2 ? 'string' : null
  }
  if (state.depth >= 2) {
    stream.eatWhile(/[^{}]/)
    return 'string'
  }

  if (state.expectKey) {
    state.expectKey = false
    if (stream.eatWhile(/[^,\s{}]/)) return 'labelName'
  }
  if (ch === ',') {
    stream.next()
    state.inValue = false
    return null
  }
  if (ch === '=') {
    stream.next()
    state.inValue = true
    return 'operator'
  }
  if (ch === '"') {
    stream.next()
    stream.eatWhile(/[^"]/)
    stream.eat('"')
    return 'string'
  }
  if (ch !== null && /\d/.test(ch)) {
    stream.eatWhile(/\d/)
    return 'number'
  }
  if (ch !== null && /[A-Za-z]/.test(ch)) {
    stream.eatWhile(/[\w-]/)
    // A bare word in value position is a @string macro reference.
    return state.inValue ? 'atom' : 'propertyName'
  }
  stream.next()
  return null
}

export const bibStreamParser = {
  name: 'bibtex',
  startState: (): BibStreamState => ({
    depth: 0,
    afterAt: false,
    expectKey: false,
    inValue: false
  }),
  token,
  languageData: {
    commentTokens: { line: '%' },
    closeBrackets: { brackets: ['{', '"'] },
    autocomplete: bibCompletion
  }
}

export function bibLanguage(): Extension {
  return StreamLanguage.define(bibStreamParser)
}
