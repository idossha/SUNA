import { parse } from 'papaparse'

/* ---------------------------------------------------------------------------
   Delimited-text -> grid model. Pure text in, data out, so the numeric-column
   heuristic and the row cap are testable without a DOM.
   ------------------------------------------------------------------------- */

/** Rows past this are dropped; the tab says so rather than rendering 100k <tr>. */
export const MAX_RENDERED_ROWS = 5000

/** Cells sampled per column when deciding whether the column is numeric. */
export const NUMERIC_SAMPLE_ROWS = 200

/** A column counts as numeric when this share of its non-empty cells parse. */
export const NUMERIC_THRESHOLD = 0.8

export interface DataTable {
  header: string[]
  /** Data rows, already capped at MAX_RENDERED_ROWS and padded to header width. */
  rows: string[][]
  /** Data rows in the file, before the cap. */
  totalRows: number
  truncated: boolean
  /** Per-column: right-align and use tabular figures. */
  numericColumns: boolean[]
  /** Parse problems worth surfacing; papaparse recovers from most of them. */
  errors: string[]
}

export function delimiterFor(fileName: string): string {
  return /\.tsv$/i.test(fileName) ? '\t' : ','
}

/**
 * Numbers as a spreadsheet would read them: optional sign, grouped or plain
 * digits, optional decimals and exponent. Deliberately excludes bare '-' and
 * things like '1.2.3' so version-ish columns stay left-aligned.
 */
const NUMERIC = /^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?([eE][+-]?\d+)?$/

export function isNumericCell(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  return NUMERIC.test(trimmed)
}

/** A column is numeric when >80% of its sampled non-empty cells are numbers. */
export function detectNumericColumns(
  rows: readonly (readonly string[])[],
  columnCount: number,
  sampleSize: number = NUMERIC_SAMPLE_ROWS
): boolean[] {
  const sample = rows.slice(0, sampleSize)
  const out: boolean[] = []
  for (let col = 0; col < columnCount; col += 1) {
    let filled = 0
    let numeric = 0
    for (const row of sample) {
      const cell = row[col] ?? ''
      if (cell.trim().length === 0) continue
      filled += 1
      if (isNumericCell(cell)) numeric += 1
    }
    out.push(filled > 0 && numeric / filled > NUMERIC_THRESHOLD)
  }
  return out
}

/** Blank trailing columns are common in hand-edited CSV; keep rows rectangular. */
function padTo(row: readonly string[], width: number): string[] {
  const out = row.slice(0, width) as string[]
  while (out.length < width) out.push('')
  return out
}

/** Parse a CSV/TSV document. The first row is the header. */
export function parseDataFile(text: string, fileName: string): DataTable {
  const result = parse<string[]>(text, {
    delimiter: delimiterFor(fileName),
    skipEmptyLines: 'greedy',
    // header handling is ours: papaparse's `header: true` would collapse
    // duplicate column names and lose column order for empty headers
    header: false
  })

  const data = result.data.filter((row): row is string[] => Array.isArray(row))
  const headerRow = data[0] ?? []
  const width = data.reduce((max, row) => Math.max(max, row.length), headerRow.length)
  const header = padTo(headerRow, width).map((name, index) =>
    name.trim().length > 0 ? name : `column ${index + 1}`
  )

  const body = data.slice(1)
  const rows = body.slice(0, MAX_RENDERED_ROWS).map((row) => padTo(row, width))

  return {
    header,
    rows,
    totalRows: body.length,
    truncated: body.length > MAX_RENDERED_ROWS,
    numericColumns: detectNumericColumns(rows, width),
    errors: result.errors.map((error) =>
      typeof error.row === 'number' ? `row ${error.row + 1}: ${error.message}` : error.message
    )
  }
}
