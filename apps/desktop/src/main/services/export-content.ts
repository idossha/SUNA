import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  AuthorsFileSchema,
  ManuscriptSchema,
  emptyAuthorsFile,
  type Affiliation,
  type Author,
  type AuthorsFile,
  type CitationRules,
  type HeadingLevel,
  type Manuscript,
  type ManuscriptFigure,
  type ManuscriptTable,
  type PublisherProfile
} from '@suna/core'
import { getBundledProfile } from '@suna/formatter'
import { outlineFromMarkdown, parseSciMark, type SciMarkRoot } from '@suna/markdown'
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
 * The shared export content model (feature-plan-6 §3/§4, updated for the
 * flat layout of feature-plan-7 §1 — "one content model, two renderers"):
 * manuscript.md + manuscript.json + authors.json + references.bib, resolved
 * through the ACTIVE PROFILE exactly the way the combined Manuscript tab
 * renders them (same citation engine, same numbering, same reference
 * ordering), independent of whether the caller wants a .docx or a .pdf out
 * the other end. Sections are no longer a stored `body` tree of section-file
 * pointers — they are DERIVED from manuscript.md with `outlineFromMarkdown`
 * (@suna/markdown), the same function the sidebar outline uses. `export-docx.ts`
 * walks `sections[i].root` (the parsed SciMark AST) into `docx` Paragraphs;
 * `export-html.ts`/`export-pdf.ts` render the same AST to HTML with
 * `@suna/markdown`'s `renderHtml`.
 *
 * A handful of small pure functions below (collectClusters, buildLabelMap,
 * orderedReferences, numberAffiliations, authorMarkers, splitTexSpans,
 * citeStyleOf, maxAuthorsFor) intentionally MIRROR their renderer-side
 * counterparts under apps/desktop/src/renderer/src/manuscript/{citations,title-page}.ts
 * and apps/desktop/src/renderer/src/views/refs.ts byte-for-byte in behavior.
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

/**
 * How figures and tables are named in captions and cross-references. Journal
 * profiles keep the abbreviated "Fig." they have always used; the SUNA house
 * style spells it "Figure", which is what docx-tools writes.
 */
export interface ExportLabelWords {
  figure: string
  table: string
}

export function buildLabelMap(
  figures: readonly Identified[],
  tables: readonly Identified[],
  sections: readonly LabelMapSection[],
  words: ExportLabelWords = DEFAULT_LABEL_WORDS
): LabelMap {
  const figureMap = new Map<string, string>()
  figures.forEach((figure, i) => figureMap.set(figure.id, `${words.figure} ${i + 1}`))

  const tableMap = new Map<string, string>()
  tables.forEach((table, i) => tableMap.set(table.id, `${words.table} ${i + 1}`))

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
export type ImageNode = Extract<RootChild, { type: 'image' }>

/* ------------------------------------------------------------------ */
/* Markdown images (`![alt](../figures/x.png)`, not managed figures)    */
/* ------------------------------------------------------------------ */

export interface MarkdownImageRef {
  /** The mdast node itself, so a renderer can key already-loaded bytes by it. */
  node: RootChild
  /** The url as written (an `imageReference` is already resolved through its definition). */
  url: string
  alt: string
}

interface ImageWalkNode {
  type?: unknown
  url?: unknown
  alt?: unknown
  identifier?: unknown
  children?: unknown
}

function walkImages(node: ImageWalkNode, definitions: ReadonlyMap<string, string>, out: MarkdownImageRef[]): void {
  const alt = typeof node.alt === 'string' ? node.alt : ''
  if (node.type === 'image' && typeof node.url === 'string') {
    out.push({ node: node as unknown as RootChild, url: node.url, alt })
  } else if (node.type === 'imageReference' && typeof node.identifier === 'string') {
    const url = definitions.get(node.identifier)
    if (url !== undefined) out.push({ node: node as unknown as RootChild, url, alt })
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkImages(child as ImageWalkNode, definitions, out)
  }
}

/** Every markdown image in one section's AST, in document order. */
export function collectMarkdownImages(root: SciMarkRoot): MarkdownImageRef[] {
  const definitions = new Map<string, string>()
  for (const child of root.children as unknown as ImageWalkNode[]) {
    if (child.type === 'definition' && typeof child.identifier === 'string' && typeof child.url === 'string') {
      definitions.set(child.identifier, child.url)
    }
  }
  const out: MarkdownImageRef[] = []
  walkImages(root as unknown as ImageWalkNode, definitions, out)
  return out
}

/**
 * The images a paragraph consists of ENTIRELY — `![alt](x.png)` on its own
 * line, which mdast wraps in a paragraph, and the several-images-one-paragraph
 * form that a soft break produces (`![a](x.png)\n![b](y.png)` is ONE
 * paragraph with a `break` between the two). Empty for a paragraph that also
 * carries prose: an image sitting inside a sentence has no block to be centred
 * in and keeps its alt-text fallback.
 *
 * This is the block form the DOCX writer renders as real `ImageRun`s — one
 * centred paragraph each, which is how the HTML renderer's `<br/>` between
 * them reads on a page.
 */
export function blockImagesOf(node: RootChild): ImageNode[] {
  if (node.type !== 'paragraph') return []
  const meaningful = node.children.filter(
    (child) => child.type !== 'break' && (child.type !== 'text' || child.value.trim() !== '')
  )
  if (meaningful.length === 0) return []
  if (meaningful.some((child) => child.type !== 'image')) return []
  return meaningful as ImageNode[]
}

/** The lone image a paragraph consists of, or null when it is any other shape. */
export function blockImageOf(node: RootChild): ImageNode | null {
  const images = blockImagesOf(node)
  return images.length === 1 ? (images[0] as ImageNode) : null
}

/** Every block-level markdown image in one section, including inside blockquotes and list items. */
export function collectBlockImages(nodes: readonly RootChild[]): ImageNode[] {
  const out: ImageNode[] = []
  for (const node of nodes) {
    const images = blockImagesOf(node)
    if (images.length > 0) {
      out.push(...images)
    } else if (node.type === 'blockquote') {
      out.push(...collectBlockImages(node.children as readonly RootChild[]))
    } else if (node.type === 'list') {
      for (const item of node.children) out.push(...collectBlockImages(item.children as readonly RootChild[]))
    }
  }
  return out
}

/**
 * Every markdown table in one section, walked the same way
 * `collectBlockImages` walks images — a table nested in a blockquote or a list
 * item is still a table the writer has to be able to express.
 */
export function collectTables(nodes: readonly RootChild[]): TableNode[] {
  const out: TableNode[] = []
  for (const node of nodes) {
    if (node.type === 'table') {
      out.push(node)
    } else if (node.type === 'blockquote') {
      out.push(...collectTables(node.children as readonly RootChild[]))
    } else if (node.type === 'list') {
      for (const item of node.children) out.push(...collectTables(item.children as readonly RootChild[]))
    }
  }
  return out
}

/**
 * Absolute path a markdown image url points at, or null when it is not a local
 * file (a remote scheme, an empty url). Mirrors
 * renderer/src/editor/figureAssets.ts's `resolveImageUrl` — the renderer
 * resolves against the file that contains the image, the exporters against
 * `ExportContent.manuscriptDir`, which IS that file's directory. This only
 * says where the url points: the caller still has to run
 * `assertInsideAllowedRoot` before reading there.
 */
export function markdownImagePath(url: string, manuscriptDir: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url)) return null
  const clean = url.replace(/^file:\/\//i, '').split('#')[0]?.split('?')[0] ?? ''
  if (clean === '') return null
  return resolve(manuscriptDir, clean)
}

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
/* Outline -> typographic heading level                                 */
/* ------------------------------------------------------------------ */

/**
 * `outlineFromMarkdown` reports raw Markdown depth (1-6); publisher profiles
 * and the docx/html renderers talk in the typographic vocabulary a journal
 * uses (manuscript.ts's `HeadingLevelSchema`). Mapping is exactly what that
 * schema's docstring specifies: depth 1 → 'A', 2 → 'B', 3+ → 'C-runin'.
 * Never called for the untitled leading section (depth 0) — its `heading` is
 * `null`, so the level is not rendered.
 */
export function headingLevelForDepth(depth: number): HeadingLevel {
  if (depth <= 1) return 'A'
  if (depth === 2) return 'B'
  return 'C-runin'
}

/* ------------------------------------------------------------------ */
/* The content model itself                                             */
/* ------------------------------------------------------------------ */

export interface ExportSection {
  heading: string | null
  level: HeadingLevel
  /** Parsed SciMark AST, or null for a heading-only section with no prose. */
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
  /**
   * Absolute path of the directory holding the prose file — what a relative
   * markdown image url (`../figures/x.png`) resolves against. Without it
   * neither exporter can find an image's bytes, and the PDF page is loaded
   * from a temp directory where nothing relative resolves at all.
   */
  manuscriptDir: string
  /** The byline, from manuscript/authors.json (feature-plan-7 §1) — empty when the file doesn't exist yet. */
  authors: AuthorsFile
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

/** manuscript/authors.json, tolerant of a project that has none yet (a brand-new project mid-scaffold). */
async function readAuthorsFile(manuscriptDir: string): Promise<AuthorsFile> {
  let raw: string
  try {
    raw = await readFile(assertInsideAllowedRoot(join(manuscriptDir, 'authors.json')), 'utf8')
  } catch {
    return emptyAuthorsFile()
  }
  return AuthorsFileSchema.parse(JSON.parse(raw) as unknown)
}

export async function buildExportContent(opts: BuildExportContentOptions): Promise<ExportContent> {
  const root = assertInsideAllowedRoot(opts.dir)
  const profile = getBundledProfile(opts.profileId)
  if (profile === null) {
    throw new Error(`unknown publisher profile "${opts.profileId}"`)
  }

  const manuscript = ManuscriptSchema.parse(await readManuscript(root))
  const manuscriptDir = await projectSubdir(root, 'manuscript')
  const authors = await readAuthorsFile(manuscriptDir)

  const prosePath = assertInsideAllowedRoot(join(manuscriptDir, manuscript.manuscriptFile))
  const md = await readFile(prosePath, 'utf8')
  const outline = outlineFromMarkdown(md)
  const sections: ExportSection[] = outline.map((entry) => {
    const source = md.slice(entry.from, entry.to)
    return {
      heading: entry.level === 0 ? null : entry.title,
      level: headingLevelForDepth(entry.level),
      root: source.trim() === '' ? null : parseSciMark(source),
      source
    }
  })

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
    sections.map((s) => ({ heading: s.heading, source: s.source })),
    profile.documentStyle !== undefined ? { figure: 'Figure', table: 'Table' } : DEFAULT_LABEL_WORDS
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
    manuscriptDir,
    authors,
    profile,
    affiliations: numberAffiliations(authors.authors, authors.affiliations),
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
