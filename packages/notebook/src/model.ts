/**
 * nbformat v4 read/write, byte-compatible with the reference Python
 * implementation (`nbformat.reads` / `nbformat.writes`).
 *
 * The point of the byte compatibility is the ground rule in CLAUDE.md: the
 * .ipynb on disk IS the document. A notebook SUNA opens and saves untouched
 * must produce an EMPTY git diff, or every notebook in a repository becomes
 * a merge conflict the moment two tools disagree about whitespace. Three
 * conventions do all the work, and all three come from nbformat itself:
 *
 *   1. `json.dumps(..., indent=1, sort_keys=True, ensure_ascii=False)` plus
 *      one trailing newline.
 *   2. Multi-line strings are stored as LISTS of lines, each keeping its own
 *      trailing "\n" (Python's `str.splitlines(True)`). nbformat rejoins them
 *      on read and re-splits them on write; so does this module, which is why
 *      the in-memory model can use plain strings everywhere.
 *   3. Unknown keys are never dropped. Notebooks carry metadata from tools
 *      that have nothing to do with SUNA (widget state, kernel specs, extension
 *      settings); throwing those away on save would be data loss, so every
 *      object here keeps an index signature and is MUTATED rather than rebuilt.
 */

/** Stored as a string or a list of lines; always a string in this model. */
export type MultilineString = string | string[]

export type CellType = 'code' | 'markdown' | 'raw'

export interface BaseCell {
  cell_type: CellType
  source: MultilineString
  metadata: Record<string, unknown>
  /** nbformat 4.5+; absent in older files and not invented here. */
  id?: string
  [key: string]: unknown
}

export interface CodeCell extends BaseCell {
  cell_type: 'code'
  execution_count: number | null
  outputs: Output[]
}

export interface MarkdownCell extends BaseCell {
  cell_type: 'markdown'
}

export interface RawCell extends BaseCell {
  cell_type: 'raw'
}

export type Cell = CodeCell | MarkdownCell | RawCell

export interface StreamOutput {
  output_type: 'stream'
  /** 'stdout' or 'stderr'; stderr is rendered as a warning, not an error. */
  name: string
  text: MultilineString
  [key: string]: unknown
}

export interface DisplayOutput {
  output_type: 'display_data' | 'execute_result'
  data: Record<string, unknown>
  metadata: Record<string, unknown>
  execution_count?: number | null
  [key: string]: unknown
}

export interface ErrorOutput {
  output_type: 'error'
  ename: string
  evalue: string
  /** Lines, ANSI escapes and all — kept verbatim so colours survive. */
  traceback: string[]
  [key: string]: unknown
}

export type Output = StreamOutput | DisplayOutput | ErrorOutput

export interface Notebook {
  cells: Cell[]
  metadata: Record<string, unknown>
  nbformat: number
  nbformat_minor: number
  [key: string]: unknown
}

/** A .ipynb that could not be understood. Carries the reason, not a stack. */
export class NotebookParseError extends Error {}

/** Python's `''.join(...)` of `splitlines(True)` — i.e. the identity. */
export function joinLines(value: MultilineString): string {
  return typeof value === 'string' ? value : value.join('')
}

/**
 * Python's `str.splitlines(True)`: split AFTER each newline, keeping it, and
 * yield no trailing empty element. An empty string yields an empty list.
 */
export function splitLines(value: string): string[] {
  if (value === '') return []
  const lines = value.split('\n')
  const last = lines.pop() as string
  const out = lines.map((line) => `${line}\n`)
  if (last !== '') out.push(last)
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Mime types whose string values nbformat stores as line lists. Read off
 * nbformat 5's `_split_mimebundle` / `_is_json_mime` (v4/rwbase.py), not
 * guessed: everything `text/*` plus these two. Notably NOT `image/png` — a
 * base64 blob stays one long string, so anything that "helpfully" splits it
 * rewrites every notebook that has a figure in it.
 */
const SPLIT_MIMES = new Set(['image/svg+xml', 'application/javascript'])

function isSplitMime(mime: string): boolean {
  return mime.startsWith('text/') || SPLIT_MIMES.has(mime)
}

/** `application/json` and any `application/*+json`: real JSON, never lines. */
function isJsonMime(mime: string): boolean {
  return mime === 'application/json' || (mime.startsWith('application/') && mime.endsWith('+json'))
}

function rejoinMimebundle(data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (isJsonMime(key)) continue
    if (Array.isArray(value) && value.every((line) => typeof line === 'string')) {
      data[key] = (value as string[]).join('')
    }
  }
}

function splitMimebundle(data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && isSplitMime(key)) data[key] = splitLines(value)
  }
}

/** Markdown cells carry pasted images in `attachments`, keyed by file name. */
function eachAttachmentBundle(cell: Cell, visit: (data: Record<string, unknown>) => void): void {
  const attachments = cell['attachments']
  if (!isRecord(attachments)) return
  for (const bundle of Object.values(attachments)) {
    if (isRecord(bundle)) visit(bundle)
  }
}

/** nbformat's `rejoin_lines`: line lists become strings, in place. */
function rejoinLines(nb: Notebook): void {
  for (const cell of nb.cells) {
    if (Array.isArray(cell.source)) cell.source = joinLines(cell.source)
    eachAttachmentBundle(cell, rejoinMimebundle)
    if (cell.cell_type !== 'code') continue
    for (const output of cell.outputs) {
      if (output.output_type === 'display_data' || output.output_type === 'execute_result') {
        if (isRecord(output.data)) rejoinMimebundle(output.data)
      } else if (Array.isArray((output as StreamOutput).text)) {
        // nbformat rejoins a list `text` on ANY output type, not just stream.
        ;(output as StreamOutput).text = joinLines((output as StreamOutput).text)
      }
    }
  }
}

/**
 * nbformat's `split_lines`, on a copy — serializing must never disturb the
 * notebook the editor is still holding. A JSON round trip is the right clone
 * here precisely because the thing being cloned is about to become JSON: any
 * value it could not survive is a value that was never going to reach disk.
 */
function splitLinesDeep(nb: Notebook): Notebook {
  const copy = JSON.parse(JSON.stringify(nb)) as Notebook
  for (const cell of copy.cells) {
    if (typeof cell.source === 'string') cell.source = splitLines(cell.source)
    eachAttachmentBundle(cell, splitMimebundle)
    if (cell.cell_type !== 'code') continue
    for (const output of cell.outputs) {
      if (output.output_type === 'display_data' || output.output_type === 'execute_result') {
        if (isRecord(output.data)) splitMimebundle(output.data)
      } else if (output.output_type === 'stream' && typeof output.text === 'string') {
        output.text = splitLines(output.text)
      }
    }
  }
  return copy
}

/** Rebuild every object with its keys in sorted order (json sort_keys=True). */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key])
  return out
}

/**
 * Parse .ipynb text. Only the shape the renderer relies on is enforced —
 * a notebook with an odd metadata block is still a notebook, and refusing to
 * open it would help nobody.
 */
export function parseNotebook(text: string): Notebook {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new NotebookParseError(
      `not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!isRecord(raw)) throw new NotebookParseError('top level is not an object')
  if (!Array.isArray(raw['cells'])) throw new NotebookParseError('no "cells" array')
  const nbformat = raw['nbformat']
  if (typeof nbformat === 'number' && nbformat < 4) {
    throw new NotebookParseError(
      `nbformat ${nbformat} is not supported — open it once in Jupyter to upgrade it to v4`
    )
  }

  const nb = raw as unknown as Notebook
  nb.metadata = isRecord(nb.metadata) ? nb.metadata : {}
  nb.nbformat = typeof nb.nbformat === 'number' ? nb.nbformat : 4
  nb.nbformat_minor = typeof nb.nbformat_minor === 'number' ? nb.nbformat_minor : 5

  for (const cell of nb.cells) {
    if (!isRecord(cell)) throw new NotebookParseError('a cell is not an object')
    // Anything that is neither code nor markdown — 'raw', or a type from a
    // future nbformat — is treated as raw: shown verbatim rather than
    // rejected, so the file still opens and still round-trips.
    if (cell['cell_type'] !== 'code' && cell['cell_type'] !== 'markdown') {
      cell['cell_type'] = 'raw'
    }
    if (typeof cell['source'] !== 'string' && !Array.isArray(cell['source'])) cell['source'] = ''
    if (!isRecord(cell['metadata'])) cell['metadata'] = {}
    if (cell['cell_type'] === 'code') {
      if (!Array.isArray(cell['outputs'])) cell['outputs'] = []
      if (typeof cell['execution_count'] !== 'number') cell['execution_count'] = null
    }
  }

  rejoinLines(nb)
  return nb
}

/** Serialize to the exact bytes `nbformat.writes` would produce. */
export function serializeNotebook(nb: Notebook): string {
  return `${JSON.stringify(sortKeysDeep(splitLinesDeep(nb)), null, 1)}\n`
}
