import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ManuscriptSchema,
  type Affiliation,
  type Author,
  type BodyNode,
  type CitationRules,
  type HeadingLevel,
  type Manuscript,
  type ManuscriptFigure,
  type ManuscriptTable,
  type PublisherProfile
} from '@suna/core'
import { getBundledProfile } from '@suna/formatter'
import { parseSciMark, type SciMarkRoot } from '@suna/markdown'
import {
  assignNumbers,
  formatReference,
  parseBibtex,
  type BibEntry,
  type CitationCluster,
  type CitationStyleConfig,
  type Run
} from '@suna/bib'
import { readManuscript } from './manuscript'
import { projectSubdir } from './paths'
import { assertInsideAllowedRoot } from './roots'

/**
 * The shared export content model (feature-plan-6 §3/§4 — "one content
 * model, two renderers"): manuscript.json + sections/*.md + references.bib,
 * resolved through the ACTIVE PROFILE exactly the way the combined
 * Manuscript tab renders them (same citation engine, same numbering, same
 * reference ordering), independent of whether the caller wants a .docx or a
 * .pdf out the other end. `export-docx.ts` walks `sections[i].root` (the
 * parsed SciMark AST) into `docx` Paragraphs; `export-html.ts`/`export-pdf.ts`
 * render the same AST to HTML with `@suna/markdown`'s `renderHtml`.
 *
 * A handful of small pure functions below (flattenBody, collectClusters,
 * buildLabelMap, orderedReferences, numberAffiliations, authorMarkers,
 * splitTexSpans, citeStyleOf, maxAuthorsFor) intentionally MIRROR their
 * renderer-side counterparts under
 * apps/desktop/src/renderer/src/manuscript/{citations,title-page}.ts and
 * apps/desktop/src/renderer/src/views/refs.ts byte-for-byte in behavior.
 * They are duplicated rather than imported because tsconfig.node.json's
 * `include` is scoped to `src/main`/`src/preload` only (no DOM lib, no
 * renderer sources) — main can't import renderer/src without blurring that
 * build boundary. Keep any future fix to the citation/label/reference
 * pipeline in sync across both copies.
 */

/* ------------------------------------------------------------------ */
/* Small pure mirrors of renderer/src/manuscript/title-page.ts          */
/* ------------------------------------------------------------------ */

export type TexSegment = { kind: 'text'; value: string } | { kind: 'math'; value: string }

/** Split "…$math$…" into text/math segments. Unclosed `$` stays literal text. */
export function splitTexSpans(source: string): TexSegment[] {
  const segments: TexSegment[] = []
  let rest = source
  for (;;) {
    const open = rest.indexOf('$')
    if (open < 0) break
    const close = rest.indexOf('$', open + 1)
    if (close < 0) break
    if (open > 0) segments.push({ kind: 'text', value: rest.slice(0, open) })
    segments.push({ kind: 'math', value: rest.slice(open + 1, close) })
    rest = rest.slice(close + 1)
  }
  if (rest !== '') segments.push({ kind: 'text', value: rest })
  return segments
}

export interface AffiliationNumbering {
  ordered: Affiliation[]
  numberOf: Map<string, number>
}

export function numberAffiliations(
  authors: readonly Author[],
  affiliations: readonly Affiliation[]
): AffiliationNumbering {
  const byId = new Map(affiliations.map((a) => [a.id, a]))
  const ordered: Affiliation[] = []
  const numberOf = new Map<string, number>()
  const push = (id: string): void => {
    const affiliation = byId.get(id)
    if (affiliation === undefined || numberOf.has(id)) return
    ordered.push(affiliation)
    numberOf.set(id, ordered.length)
  }
  for (const author of authors) for (const id of author.affiliationRefs) push(id)
  for (const affiliation of affiliations) push(affiliation.id)
  return { ordered, numberOf }
}

export function authorMarkers(author: Author, numberOf: ReadonlyMap<string, number>): string[] {
  const markers: string[] = []
  for (const id of author.affiliationRefs) {
    const n = numberOf.get(id)
    if (n !== undefined) markers.push(String(n))
  }
  if (author.corresponding) markers.push('*')
  return markers
}

/* ------------------------------------------------------------------ */
/* Small pure mirrors of renderer/src/manuscript/citations.ts           */
/* ------------------------------------------------------------------ */

interface WalkNode {
  type?: unknown
  children?: unknown
  keys?: unknown
  narrative?: unknown
}

function walkClusters(node: WalkNode, out: CitationCluster[]): void {
  if (node.type === 'citation' && Array.isArray(node.keys)) {
    out.push({
      keys: node.keys.filter((k): k is string => typeof k === 'string'),
      narrative: node.narrative === true
    })
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkClusters(child as WalkNode, out)
  }
}

/** Citation clusters of one SciMark source, in order of appearance. */
export function collectClusters(source: string): CitationCluster[] {
  const out: CitationCluster[] = []
  walkClusters(parseSciMark(source) as WalkNode, out)
  return out
}

export interface LabelMap {
  figures: ReadonlyMap<string, string>
  tables: ReadonlyMap<string, string>
  equations: ReadonlyMap<string, string>
  sections: ReadonlyMap<string, string>
}

export interface LabelMapSection {
  heading: string | null
  source: string
}

export interface Identified {
  id: string
}

export function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const EQ_LABEL = /^\{#eq:([A-Za-z][\w:.-]*)\}$/

interface MathWalkNode {
  type?: unknown
  children?: unknown
  meta?: unknown
}

function walkEquationLabels(node: MathWalkNode, out: (string | undefined)[]): void {
  if (node.type === 'math') {
    const meta = typeof node.meta === 'string' ? node.meta.trim() : ''
    out.push(EQ_LABEL.exec(meta)?.[1])
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkEquationLabels(child as MathWalkNode, out)
  }
}

function collectEquationLabels(source: string): (string | undefined)[] {
  const out: (string | undefined)[] = []
  walkEquationLabels(parseSciMark(source) as unknown as MathWalkNode, out)
  return out
}

const DEFAULT_LABEL_WORDS = { figure: 'Fig.', table: 'Table' } as const

export function buildLabelMap(
  figures: readonly Identified[],
  tables: readonly Identified[],
  sections: readonly LabelMapSection[]
): LabelMap {
  const figureMap = new Map<string, string>()
  figures.forEach((figure, i) => figureMap.set(figure.id, `${DEFAULT_LABEL_WORDS.figure} ${i + 1}`))

  const tableMap = new Map<string, string>()
  tables.forEach((table, i) => tableMap.set(table.id, `${DEFAULT_LABEL_WORDS.table} ${i + 1}`))

  const equationMap = new Map<string, string>()
  let eqNumber = 0
  for (const section of sections) {
    for (const label of collectEquationLabels(section.source)) {
      eqNumber += 1
      if (label !== undefined) equationMap.set(label, `equation (${eqNumber})`)
    }
  }

  const sectionMap = new Map<string, string>()
  for (const section of sections) {
    if (section.heading === null) continue
    const slug = slugifyHeading(section.heading)
    if (slug.length === 0 || sectionMap.has(slug)) continue
    sectionMap.set(slug, section.heading)
  }

  return { figures: figureMap, tables: tableMap, equations: equationMap, sections: sectionMap }
}

export interface ReferenceRow {
  key: string
  entry: BibEntry | undefined
  number: number
}

function alphaKey(entry: BibEntry): string {
  const first = entry.authors[0]
  const name = first === undefined ? '' : first.kind === 'person' ? first.family : first.literal
  return `${name.toLowerCase()} ${entry.year ?? ''} ${entry.title.toLowerCase()}`
}

export function orderedReferences(
  numbers: ReadonlyMap<string, number>,
  entryMap: ReadonlyMap<string, BibEntry>,
  sortOrder: 'appearance' | 'alphabetical'
): ReferenceRow[] {
  const rows: ReferenceRow[] = [...numbers.entries()].map(([key, number]) => ({
    key,
    entry: entryMap.get(key),
    number
  }))
  const known = rows.filter((r) => r.entry !== undefined)
  const unknown = rows.filter((r) => r.entry === undefined)
  if (sortOrder === 'alphabetical') {
    known.sort((a, b) => {
      if (a.entry === undefined || b.entry === undefined) return 0
      return alphaKey(a.entry) < alphaKey(b.entry) ? -1 : 1
    })
  } else {
    known.sort((a, b) => a.number - b.number)
  }
  unknown.sort((a, b) => a.number - b.number)
  return [...known, ...unknown]
}

/* ------------------------------------------------------------------ */
/* Small pure mirrors of renderer/src/views/refs.ts                     */
/* ------------------------------------------------------------------ */

export function maxAuthorsFor(
  rules: CitationRules['referenceList']['authorTruncation'],
  authorCount: number
): number {
  const floor = Math.max(authorCount, 1)
  if (rules.etAlAllowed === false) return floor
  const threshold = rules.truncateWhenMoreThan
  if (threshold === null || authorCount <= threshold) return floor
  return rules.keepFirstN ?? threshold
}

export function citeStyleOf(rules: CitationRules): CitationStyleConfig {
  return { mode: rules.mode, collapseRanges: rules.collapseRanges, textualTokens: rules.textualTokens }
}

/** The formatted reference-list entry for one row, in the profile's style — null for an unresolved key. */
export function formatReferenceRow(row: ReferenceRow, profile: PublisherProfile): Run[] | null {
  if (row.entry === undefined) return null
  return formatReference(row.entry, {
    maxAuthors: maxAuthorsFor(profile.citations.referenceList.authorTruncation, row.entry.authors.length)
  })
}

/** True when the profile's citation list is numbered ("1.", "2.", …) rather than plain author-year. */
export function isNumericCitationMode(profile: PublisherProfile): boolean {
  return profile.citations.mode !== 'author-year'
}

/**
 * Print width (mm) for a figure's width preset. Mirrors the fallback table in
 * renderer/src/canvas/export-presets.ts's `widthPresetsFor` — used only when
 * the profile leaves that preset `null` ("does not state this").
 */
const FALLBACK_WIDTH_MM: Record<'single' | 'double', number> = { single: 89, double: 180 }

export function widthMmForPreset(preset: 'single' | 'double', profile: PublisherProfile): number {
  return profile.figures.widthPresetsMm[preset] ?? FALLBACK_WIDTH_MM[preset]
}

/**
 * Structural mdast node types derived from `SciMarkRoot` rather than named
 * imports from the `mdast` package: `mdast`'s own type declarations
 * (`@types/mdast`) are only a devDependency of `@suna/markdown`, resolvable
 * from files physically inside packages/markdown/src (which is where
 * `SciMarkRoot`'s definition itself resolves them) but NOT from apps/desktop
 * — pnpm's per-package node_modules isolation means a workspace consumer
 * only sees what the producing package's `package.json` lists as a runtime
 * dependency or re-exports. Indexing through the already-resolved
 * `SciMarkRoot` type sidesteps that boundary entirely.
 */
export type RootChild = SciMarkRoot['children'][number]
export type ListNode = Extract<RootChild, { type: 'list' }>
export type ListItemNode = ListNode['children'][number]
export type TableNode = Extract<RootChild, { type: 'table' }>

/**
 * Pixel dimensions straight from a PNG's IHDR chunk (bytes 16-23: width,
 * height as big-endian uint32) — the docx renderer needs the source pixel
 * aspect to size its `ImageRun` transformation; the HTML/PDF renderer just
 * sets a CSS width and lets `height: auto` do this for free.
 */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const isPng = sig.every((byte, i) => bytes[i] === byte)
  if (!isPng || bytes.length < 24) {
    throw new Error('not a valid PNG (bad signature or truncated header)')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/* ------------------------------------------------------------------ */
/* Body flattening — mirrors renderer/src/views/outline.ts's           */
/* flattenBody, but keeps the raw HeadingLevel ('box' for BoxNode)      */
/* rather than outline.ts's display "chip" collapse (A/B/C).            */
/* ------------------------------------------------------------------ */

export interface FlatBodyRow {
  heading: string | null
  level: HeadingLevel | 'box'
  contentPath: string | null
}

export function flattenManuscriptBody(nodes: readonly BodyNode[]): FlatBodyRow[] {
  const out: FlatBodyRow[] = []
  for (const node of nodes) {
    if (node.kind === 'section') {
      out.push({ heading: node.heading, level: node.level, contentPath: node.content })
      out.push(...flattenManuscriptBody(node.children))
    } else {
      out.push({ heading: node.title, level: 'box', contentPath: node.content })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* The content model itself                                             */
/* ------------------------------------------------------------------ */

export interface ExportSection {
  heading: string | null
  level: HeadingLevel | 'box'
  /** Parsed SciMark AST, or null for a heading-only node with no prose. */
  root: SciMarkRoot | null
  source: string
}

export interface ExportFigureContent {
  figure: ManuscriptFigure
  /** "Fig. N" — same numbering buildLabelMap/the live document uses (array order, any namespace). */
  label: string
  /** Absolute path to an already-rasterized PNG (see figurePngPaths contract on the IPC channels). */
  pngPath: string
}

export interface ExportTableContent {
  table: ManuscriptTable
  /** "Table N". */
  label: string
}

export interface ExportContent {
  manuscript: Manuscript
  profile: PublisherProfile
  affiliations: AffiliationNumbering
  sections: ExportSection[]
  numbers: Map<string, number>
  entryMap: Map<string, BibEntry>
  citeStyle: CitationStyleConfig
  referenceRows: ReferenceRow[]
  labels: LabelMap
  figures: ExportFigureContent[]
  tables: ExportTableContent[]
  /** Total resolvable reference count (for the compliance checker / footers), i.e. referenceRows.length. */
  referenceCount: number
}

export interface BuildExportContentOptions {
  dir: string
  profileId: string
  /** figureId -> absolute path to an already-rasterized PNG. */
  figurePngPaths: Readonly<Record<string, string>>
}

export async function buildExportContent(opts: BuildExportContentOptions): Promise<ExportContent> {
  const root = assertInsideAllowedRoot(opts.dir)
  const profile = getBundledProfile(opts.profileId)
  if (profile === null) {
    throw new Error(`unknown publisher profile "${opts.profileId}"`)
  }

  const manuscript = ManuscriptSchema.parse(await readManuscript(root))
  const manuscriptDir = await projectSubdir(root, 'manuscript')

  const flat = flattenManuscriptBody(manuscript.body)
  const sections: ExportSection[] = []
  for (const row of flat) {
    let source = ''
    if (row.contentPath !== null) {
      const path = assertInsideAllowedRoot(join(manuscriptDir, row.contentPath))
      source = await readFile(path, 'utf8')
    }
    sections.push({
      heading: row.heading,
      level: row.level,
      root: source === '' ? null : parseSciMark(source),
      source
    })
  }

  const clusters = sections.flatMap((s) => collectClusters(s.source))
  const numbers = assignNumbers(clusters.map((c) => [...c.keys]))

  const bibPath = join(manuscriptDir, manuscript.bibliography)
  let bibText = ''
  try {
    bibText = await readFile(assertInsideAllowedRoot(bibPath), 'utf8')
  } catch {
    // no references.bib yet — an empty bibliography is a valid (if unusual) state
  }
  const parsedBib = parseBibtex(bibText)
  const entryMap = new Map(parsedBib.entries.map((e) => [e.key, e]))

  const citeStyle = citeStyleOf(profile.citations)
  const referenceRows = orderedReferences(numbers, entryMap, profile.citations.referenceList.sortOrder)

  const labels = buildLabelMap(
    manuscript.figures,
    manuscript.tables,
    sections.map((s) => ({ heading: s.heading, source: s.source }))
  )

  const figures: ExportFigureContent[] = manuscript.figures.map((figure) => {
    const pngPath = opts.figurePngPaths[figure.id]
    if (pngPath === undefined) {
      throw new Error(
        `no rasterized PNG supplied for figure "${figure.id}" — rasterize every manuscript figure ` +
          `(figure:export 'png' + figure:write-binary) before calling export:docx/export:pdf`
      )
    }
    return {
      figure,
      label: labels.figures.get(figure.id) ?? figure.id,
      pngPath: assertInsideAllowedRoot(pngPath)
    }
  })

  const tables: ExportTableContent[] = manuscript.tables.map((table) => ({
    table,
    label: labels.tables.get(table.id) ?? table.id
  }))

  return {
    manuscript,
    profile,
    affiliations: numberAffiliations(manuscript.authors, manuscript.affiliations),
    sections,
    numbers,
    entryMap,
    citeStyle,
    referenceRows,
    labels,
    figures,
    tables,
    referenceCount: referenceRows.length
  }
}
