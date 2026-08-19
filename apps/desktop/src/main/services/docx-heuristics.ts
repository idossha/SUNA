/**
 * DOCX front-matter and section heuristics (feature-plan-6 §2.2/§2.3). Every
 * function here is pure over a `Block[]` (see docx-html.ts) so it is
 * unit-testable without mammoth or Electron, and every detector returns a
 * `reason` string alongside its result — the review screen shows the reason
 * verbatim, per the spec's "documented, testable, and reported to the user"
 * requirement. Nothing here writes anything; docx-import.ts commits.
 */

import type { Block, Run } from './docx-html'
import { blockText, isBlankRuns, isFullyBold, runsToPlainText } from './docx-html'

/* ------------------------------------------------------------------ */
/* Title                                                                */
/* ------------------------------------------------------------------ */

export interface DetectedTitle {
  value: string | null
  /** Index into `blocks` the title was read from; null when nothing matched. */
  index: number | null
  reason: string
}

/**
 * "The first non-empty block that is a heading OR a fully-bold paragraph
 * before any body text" (spec). A heading always wins over a bold paragraph
 * at the same or a later position — Word documents that DO use the semantic
 * Title/Heading style are the more reliable signal when both are present
 * before the first plain paragraph.
 */
export function detectTitle(blocks: readonly Block[]): DetectedTitle {
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block === undefined) continue
    if (block.kind === 'heading') {
      const text = blockText(block).trim()
      if (text !== '') {
        return { value: text, index: i, reason: `heading (level ${block.level}), first block in the document` }
      }
    }
    if (block.kind === 'paragraph' && isFullyBold(block.runs)) {
      const text = blockText(block).trim()
      if (text !== '') {
        return { value: text, index: i, reason: 'fully-bold paragraph before any body text' }
      }
    }
    // A plain (non-bold, non-heading) paragraph means body text has started —
    // stop looking, per "before any body text".
    if (block.kind === 'paragraph' && !isBlankRuns(block.runs)) break
  }
  return { value: null, index: null, reason: 'no heading or fully-bold paragraph found before body text' }
}

/* ------------------------------------------------------------------ */
/* Authors                                                              */
/* ------------------------------------------------------------------ */

export interface DetectedAuthor {
  name: string
  given: string
  family: string
  markers: string[]
}

export interface DetectedAuthors {
  authors: DetectedAuthor[]
  index: number | null
  reason: string
}

/** Trailing superscript-like marker tokens split off a name ("Jane Smith1,2" → "1,2"). */
const TRAILING_MARKER_RE = /^(.*?)([*†‡§¶#]|\d+(?:\s*,\s*\d+)*)$/

function splitTrailingMarkers(nameWithMarkers: string): { name: string; markers: string[] } {
  const trimmed = nameWithMarkers.trim()
  const match = TRAILING_MARKER_RE.exec(trimmed)
  if (match === null) return { name: trimmed, markers: [] }
  const namePart = (match[1] as string).trim()
  const markerPart = match[2] as string
  if (namePart === '') return { name: trimmed, markers: [] }
  const markers = /^\d/.test(markerPart) ? markerPart.split(',').map((m) => m.trim()) : [markerPart]
  return { name: namePart, markers }
}

/** "Given Middle Family" → { given: "Given Middle", family: "Family" }. A
 *  single-token name (rare — a mononym, or a split that failed) keeps the
 *  whole token in both fields rather than leaving `given` empty: AuthorSchema
 *  requires both non-empty, and duplicating beats fabricating a value. */
function splitName(name: string): { given: string; family: string } {
  const parts = name.trim().split(/\s+/).filter((p) => p !== '')
  const family = parts[parts.length - 1]
  if (family === undefined) return { given: name.trim() || '—', family: name.trim() || '—' }
  if (parts.length === 1) return { given: family, family }
  return { given: parts.slice(0, -1).join(' '), family }
}

/** Splits an author-line's plain text into name segments on commas/semicolons
 *  and "and"/"&", tolerant of "Family, G." comma-in-name forms by requiring
 *  the segment before a comma to look like more than a bare initial. */
function splitAuthorNames(text: string): string[] {
  const bySemicolon = text.split(';')
  const out: string[] = []
  for (const chunk of bySemicolon) {
    for (const piece of chunk.split(/,| and | & /i)) {
      const t = piece.trim()
      if (t !== '') out.push(t)
    }
  }
  return out
}

/** Runs → per-name marker tokens, using `<sup>` runs immediately following a
 *  name as the marker signal when present (the reliable case: markers travel
 *  with the exact name they follow, comma-split text does not). Falls back to
 *  trailing-digit/symbol splitting on the plain text when there are no sup
 *  runs at all (comma-separated names with no affiliation markers). */
function namesFromRuns(runs: readonly Run[]): DetectedAuthor[] {
  const hasSup = runs.some((r) => r.sup === true && r.text.trim() !== '')
  if (!hasSup) {
    return splitAuthorNames(runsToPlainText(runs)).map((raw) => {
      const { name, markers } = splitTrailingMarkers(raw)
      const { given, family } = splitName(name)
      return { name, given, family, markers }
    })
  }

  const authors: DetectedAuthor[] = []
  let buffer = ''
  const flush = (markers: string[]): void => {
    const name = buffer.trim().replace(/^[,;\s]+|[,;\s]+$/g, '')
    buffer = ''
    if (name === '') return
    const { given, family } = splitName(name)
    authors.push({ name, given, family, markers })
  }
  for (const run of runs) {
    if (run.sup === true) {
      const markers = run.text
        .split(',')
        .map((m) => m.trim())
        .filter((m) => m !== '')
      flush(markers)
      continue
    }
    buffer += run.text
  }
  if (buffer.trim().replace(/^[,;\s]+|[,;\s]+$/g, '') !== '') flush([])
  return authors
}

/**
 * "The next paragraph containing `<sup>` markers or comma-separated names"
 * after the title. Scans forward from `afterIndex`, skipping blank
 * paragraphs, and takes the first non-blank paragraph that is not itself
 * another heading/bold title-like line.
 */
export function detectAuthors(blocks: readonly Block[], afterIndex: number): DetectedAuthors {
  for (let i = afterIndex + 1; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block === undefined) continue
    if (block.kind === 'heading') break // ran into the next section before finding an author line
    if (block.kind !== 'paragraph' || isBlankRuns(block.runs)) continue
    const authors = namesFromRuns(block.runs)
    if (authors.length === 0) continue
    const hasSup = block.runs.some((r) => r.sup === true && r.text.trim() !== '')
    return {
      authors,
      index: i,
      reason: hasSup
        ? 'paragraph after the title whose text is broken up by <sup> affiliation markers'
        : 'paragraph after the title, split on commas/semicolons/"and" (no <sup> markers found)'
    }
  }
  return { authors: [], index: null, reason: 'no paragraph with <sup> markers or comma-separated names found after the title' }
}

/* ------------------------------------------------------------------ */
/* Affiliations                                                         */
/* ------------------------------------------------------------------ */

export interface DetectedAffiliation {
  marker: string
  text: string
}

export interface DetectedAffiliations {
  affiliations: DetectedAffiliation[]
  usedIndices: number[]
  reason: string
}

const LEADING_MARKER_RE = /^\s*(?:[*†‡§¶#]|\d+)\s*[.):]?\s*(.+)$/

/**
 * "Subsequent short paragraphs beginning with a digit or `<sup>` marker",
 * scanned immediately after the author line. A short paragraph (< 200 chars,
 * heuristic ceiling so a normal body paragraph that happens to start with a
 * number — "1. Introduction" mis-split, a list item, etc. — never gets
 * swallowed) whose FIRST run is a `<sup>` marker or whose text starts with a
 * bare digit/symbol marker counts; the scan stops at the first paragraph that
 * doesn't match (affiliations are contiguous in every source seen).
 */
export function detectAffiliations(blocks: readonly Block[], afterIndex: number): DetectedAffiliations {
  const affiliations: DetectedAffiliation[] = []
  const usedIndices: number[] = []
  let i = afterIndex + 1
  for (; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block === undefined) break
    if (block.kind === 'heading') break
    if (block.kind !== 'paragraph' || isBlankRuns(block.runs)) {
      if (block.kind === 'paragraph') continue // blank paragraph between entries — skip, keep scanning
      break
    }
    const text = runsToPlainText(block.runs).trim()
    if (text.length > 200) break

    const firstRun = block.runs[0]
    if (firstRun !== undefined && firstRun.sup === true && firstRun.text.trim() !== '') {
      const marker = firstRun.text.trim()
      const rest = runsToPlainText(block.runs.slice(1)).trim()
      if (rest === '') break
      affiliations.push({ marker, text: rest })
      usedIndices.push(i)
      continue
    }
    const match = LEADING_MARKER_RE.exec(text)
    if (match !== null) {
      const markerChar = text.charAt(0) === ' ' ? text.trim().charAt(0) : text.charAt(0)
      const numMatch = /^\s*(\d+)/.exec(text)
      const marker = numMatch !== null ? (numMatch[1] as string) : markerChar
      const rest = (match[1] as string).trim()
      if (rest === '') break
      affiliations.push({ marker, text: rest })
      usedIndices.push(i)
      continue
    }
    break
  }
  if (affiliations.length === 0) {
    return { affiliations, usedIndices, reason: 'no paragraphs starting with a digit or <sup> marker found after the author line' }
  }
  return {
    affiliations,
    usedIndices,
    reason: `${affiliations.length} contiguous marker-led paragraph(s) after the author line`
  }
}

/* ------------------------------------------------------------------ */
/* Abstract                                                             */
/* ------------------------------------------------------------------ */

export interface DetectedAbstract {
  value: string | null
  /** The abstract paragraph's index. */
  index: number | null
  /** The "Abstract"/"Summary" heading's own index — also excluded from the body. */
  headingIndex: number | null
  reason: string
}

const ABSTRACT_HEADING_RE = /^(abstract|summary)\s*:?\s*$/i

/** "A paragraph following a heading matching /abstract|summary/i." */
export function detectAbstract(blocks: readonly Block[]): DetectedAbstract {
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block === undefined || block.kind !== 'heading') continue
    if (!ABSTRACT_HEADING_RE.test(blockText(block).trim())) continue
    for (let j = i + 1; j < blocks.length; j += 1) {
      const next = blocks[j]
      if (next === undefined) break
      if (next.kind === 'heading') break
      if (next.kind === 'paragraph' && !isBlankRuns(next.runs)) {
        return {
          value: runsToPlainText(next.runs).trim(),
          index: j,
          headingIndex: i,
          reason: `paragraph following a heading matching /abstract|summary/i ("${blockText(block).trim()}")`
        }
      }
    }
  }
  return { value: null, index: null, headingIndex: null, reason: 'no heading matching /abstract|summary/i with a following paragraph found' }
}

/* ------------------------------------------------------------------ */
/* Significance / highlights / keywords                                 */
/* ------------------------------------------------------------------ */

/**
 * A title-page block the manuscript schema stores as a FIELD, not as prose:
 * `significance`, `highlights` and `keywords` belong on the title page, so
 * leaving them in the body would both lose them (the title page would render
 * empty) and duplicate them (they would open the manuscript as section one).
 * Each detector reports the indices it consumed so the body excludes them.
 */
export interface DetectedBlock<T> {
  value: T
  usedIndices: number[]
  reason: string
}

const SIGNIFICANCE_HEADING_RE =
  /^(statement\s+of\s+significance|significance(\s+statement)?)\s*:?\s*$/i
const HIGHLIGHTS_HEADING_RE = /^highlights\s*:?\s*$/i
const KEYWORDS_RE = /^key\s?words\s*[:\u2014\u2013-]\s*(.+)$/i

/** The blocks between `headingIndex` and the next heading. */
function blocksUnderHeading(blocks: readonly Block[], headingIndex: number): number[] {
  const indices: number[] = []
  for (let j = headingIndex + 1; j < blocks.length; j += 1) {
    const next = blocks[j]
    if (next === undefined || next.kind === 'heading') break
    if (next.kind === 'paragraph' && isBlankRuns(next.runs)) continue
    indices.push(j)
  }
  return indices
}

/**
 * A heading matching /statement of significance|significance/i and the prose
 * under it. Word documents that lead with a bold "Significance" run rather
 * than a real heading style are not matched — a guess there would eat the
 * first paragraph of a paper that merely discusses significance.
 */
export function detectSignificance(blocks: readonly Block[]): DetectedBlock<string | null> {
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block === undefined || block.kind !== 'heading') continue
    const heading = blockText(block).trim()
    if (!SIGNIFICANCE_HEADING_RE.test(heading)) continue
    const body = blocksUnderHeading(blocks, i)
    const text = body
      .map((j) => {
        const b = blocks[j]
        return b !== undefined && b.kind === 'paragraph' ? runsToPlainText(b.runs).trim() : ''
      })
      .filter((t) => t !== '')
      .join('\n\n')
    if (text === '') continue
    return {
      value: text,
      usedIndices: [i, ...body],
      reason: `prose under a heading matching /statement of significance|significance/i ("${heading}")`
    }
  }
  return { value: null, usedIndices: [], reason: 'no "Significance" heading with prose under it found' }
}

/** Bullets under a "Highlights" heading — a list, or one paragraph per bullet. */
export function detectHighlights(blocks: readonly Block[]): DetectedBlock<string[]> {
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block === undefined || block.kind !== 'heading') continue
    const heading = blockText(block).trim()
    if (!HIGHLIGHTS_HEADING_RE.test(heading)) continue
    const body = blocksUnderHeading(blocks, i)
    const items: string[] = []
    for (const j of body) {
      const b = blocks[j]
      if (b === undefined) continue
      if (b.kind === 'list') {
        for (const item of b.items) {
          const text = runsToPlainText(item).trim()
          if (text !== '') items.push(text)
        }
      } else if (b.kind === 'paragraph') {
        // Word bullets pasted as plain paragraphs keep their bullet glyph.
        const text = runsToPlainText(b.runs).replace(/^[\u2022\u00b7\u2043*-]\s*/, '').trim()
        if (text !== '') items.push(text)
      }
    }
    if (items.length === 0) continue
    return {
      value: items,
      usedIndices: [i, ...body],
      reason: `${items.length} bullet(s) under a heading matching /highlights/i`
    }
  }
  return { value: [], usedIndices: [], reason: 'no "Highlights" heading with bullets under it found' }
}

/**
 * A "Keywords: a; b; c" paragraph. Semicolons separate where present —
 * keywords are themselves allowed to contain commas ("sleep, slow waves") —
 * and commas only when there is no semicolon in the line.
 */
export function detectKeywords(blocks: readonly Block[]): DetectedBlock<string[]> {
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block === undefined || block.kind !== 'paragraph') continue
    const text = runsToPlainText(block.runs).trim()
    const match = KEYWORDS_RE.exec(text)
    if (match === null) continue
    const list = (match[1] as string).trim().replace(/[.;]\s*$/, '')
    const parts = (list.includes(';') ? list.split(';') : list.split(','))
      .map((k) => k.trim())
      .filter((k) => k !== '')
    if (parts.length === 0) continue
    return { value: parts, usedIndices: [i], reason: `a paragraph starting "${text.slice(0, 20)}…"` }
  }
  return { value: [], usedIndices: [], reason: 'no paragraph starting "Keywords:" found' }
}

/* ------------------------------------------------------------------ */
/* Sections                                                             */
/* ------------------------------------------------------------------ */

export interface SectionDraft {
  heading: string | null
  level: 1 | 2
  blocks: Block[]
}

/**
 * Split at h1/h2 boundaries (spec §2.3). Deeper headings (h3+) stay inside
 * the enclosing section's block list and are rendered as sub-headings in that
 * section's markdown rather than starting a new section — matching the spec's
 * own "split at h1/h2" wording.
 *
 * These drafts are what the import REVIEW screen shows and lets the user
 * edit. Since feature-plan-7 §1 they are no longer written out as
 * `sections/NN-slug.md`: `commitDocxAnalysis` joins them into the single
 * `manuscript/manuscript.md`, each draft's heading emitted at its level. The
 * split still matters, because it is the unit the reviewer renames, merges
 * and drops.
 */
export function splitSections(blocks: readonly Block[], startIndex: number, excluded: ReadonlySet<number>): SectionDraft[] {
  const sections: SectionDraft[] = []
  let current: SectionDraft = { heading: null, level: 1, blocks: [] }
  let started = false

  for (let i = startIndex; i < blocks.length; i += 1) {
    if (excluded.has(i)) continue
    const block = blocks[i]
    if (block === undefined) continue
    if (block.kind === 'heading' && (block.level === 1 || block.level === 2)) {
      if (started || current.blocks.length > 0) sections.push(current)
      current = { heading: blockText(block).trim(), level: block.level, blocks: [] }
      started = true
      continue
    }
    current.blocks.push(block)
  }
  if (current.blocks.length > 0 || started) sections.push(current)
  return sections.filter((s) => s.heading !== null || s.blocks.length > 0)
}

/** kebab-case slug for a section filename; 'section' when the heading is null/empty. */
export function slugifyHeading(heading: string | null): string {
  const base = (heading ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base === '' ? 'section' : base
}

/* ------------------------------------------------------------------ */
/* Markdown rendering                                                   */
/* ------------------------------------------------------------------ */

/** Markdown-significant characters escaped so run text can't be
 *  misinterpreted as emphasis/links/etc. Citation runs (produced by the
 *  reference-rewrite pass) set `run.citation` and bypass this entirely — see
 *  docx-references.ts. */
export function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, (ch) => `\\${ch}`)
}

/** A run whose `.text` is already final markdown (a `[@key]` citation token)
 *  and must be emitted verbatim, with no escaping/wrapping. */
export interface CitationRun extends Run {
  citation: true
}

export function isCitationRun(run: Run): run is CitationRun {
  return (run as { citation?: boolean }).citation === true
}

/** One run → its markdown span. Bold/italic use standard markdown delimiters;
 *  sup/sub have no markdown syntax, so they pass through as literal inline
 *  HTML (CommonMark spec's supported grammar — @suna/markdown's renderer
 *  already emits raw 'html' nodes verbatim, see packages/markdown/src/html.ts). */
export function runToMarkdown(run: Run): string {
  if (isCitationRun(run)) return run.text
  let text = escapeMarkdownText(run.text)
  if (run.link !== undefined) text = `[${text}](${run.link})`
  if (run.sup === true) text = `<sup>${text}</sup>`
  if (run.sub === true) text = `<sub>${text}</sub>`
  if (run.bold === true) text = `**${text}**`
  if (run.italic === true) text = `_${text}_`
  return text
}

export function runsToMarkdown(runs: readonly Run[]): string {
  return runs.map(runToMarkdown).join('')
}

function tableRowToMarkdown(row: readonly Run[][]): string {
  return `| ${row.map((cell) => runsToMarkdown(cell).replace(/\|/g, '\\|')).join(' | ')} |`
}

/** One section's Block[] → SciMark markdown text. h3+ headings inside the
 *  section become literal `###`/`####` markdown headings. */
export function blocksToMarkdown(blocks: readonly Block[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': {
        const level = Math.min(Math.max(block.level, 1), 6)
        parts.push(`${'#'.repeat(level)} ${runsToMarkdown(block.runs)}`)
        break
      }
      case 'paragraph':
        parts.push(runsToMarkdown(block.runs))
        break
      case 'list': {
        const lines = block.items.map((item, idx) =>
          block.ordered ? `${idx + 1}. ${runsToMarkdown(item)}` : `- ${runsToMarkdown(item)}`
        )
        parts.push(lines.join('\n'))
        break
      }
      case 'table': {
        const [head, ...body] = block.rows
        if (head === undefined) break
        const lines = [tableRowToMarkdown(head), `| ${head.map(() => '---').join(' | ')} |`]
        for (const row of body) lines.push(tableRowToMarkdown(row))
        parts.push(lines.join('\n'))
        break
      }
      case 'blockquote': {
        const inner = blocksToMarkdown(block.blocks)
        parts.push(
          inner
            .split('\n')
            .map((line) => (line === '' ? '>' : `> ${line}`))
            .join('\n')
        )
        break
      }
      case 'image':
        parts.push(`![${escapeMarkdownText(block.alt)}](${block.src})`)
        break
      case 'thematicBreak':
        parts.push('---')
        break
    }
  }
  return parts.filter((p) => p.trim() !== '').join('\n\n') + (parts.length > 0 ? '\n' : '')
}
