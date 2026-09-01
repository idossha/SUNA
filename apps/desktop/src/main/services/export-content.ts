import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
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
import { readVersionArchive } from './version-log'
import { projectSubdir } from './paths'
import { assertInsideAllowedRoot } from './roots'
import { resolveDocumentStyle } from './export-style'

/**
 * The shared export content model (ARCHITECTURE §13, updated for the
 * flat layout of ARCHITECTURE §4.3 — "one content model, two renderers"):
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

const DEFAULT_LABEL_WORDS = { figure: 'Figure', table: 'Table' } as const

/**
 * How figures and tables are named in captions and cross-references. The SUNA
 * default spells out "Figure" (docx-tools' shape); a journal profile whose
 * guidelines state the abbreviated form carries `figureLabel: 'Fig.'` in its
 * documentStyle delta (export-style.ts's resolveDocumentStyle).
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
 * The same nodes with every markdown table removed — including tables nested
 * in blockquotes and list items, matching exactly what `collectTables` finds.
 * Used by the `tablePlacement: 'end'` convention: the collected tables render
 * in a trailing "Tables" section, and this is what keeps them out of the body
 * (the DOCX writer drops them per-block instead; the two must stay in sync).
 */
export function withoutTables(nodes: readonly RootChild[]): RootChild[] {
  const out: RootChild[] = []
  for (const node of nodes) {
    // `tableEmbed` goes with its table: under 'end' placement the caption
    // renders in the trailing Tables section, so a caption block left in the
    // body would duplicate it.
    if (node.type === 'table' || node.type === 'tableEmbed') continue
    if (node.type === 'blockquote') {
      out.push({
        ...node,
        children: withoutTables(node.children as readonly RootChild[])
      } as unknown as RootChild)
    } else if (node.type === 'list') {
      out.push({
        ...node,
        children: node.children.map((item) => ({
          ...item,
          children: withoutTables(item.children as readonly RootChild[])
        }))
      } as unknown as RootChild)
    } else {
      out.push(node)
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
 * The path an export should actually read a markdown image from: the url
 * resolved against the content dir (which, for a versioned export, is the
 * archived manuscript dir — so `../figures/x.png` lands inside the archive
 * when the figures area was archived), falling back to the LIVE manuscript
 * dir when the archived file does not exist. Null for a non-local url.
 */
export function resolveExportImagePath(url: string, content: ExportContent): string | null {
  const primary = markdownImagePath(url, content.manuscriptDir)
  if (primary === null) return null
  if (content.imageFallbackDir !== null && !existsSync(primary)) {
    const fallback = markdownImagePath(url, content.imageFallbackDir)
    if (fallback !== null && existsSync(fallback)) return fallback
  }
  return primary
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
/* Export source: the working copy, or one logged version               */
/* ------------------------------------------------------------------ */

/** Where an export's manuscript files come from (see resolveExportSource). */
export interface ExportSource {
  /**
   * Directory every manuscript file is read from — manuscript.md,
   * manuscript.json, authors.json, references.bib, supplementary.md, table
   * files. The live `manuscript/` dir, or the version's archived copy.
   */
  contentDir: string
  /**
   * Base a PROJECT-RELATIVE ref (a figure's `canvasRef` like `figures/...`)
   * resolves against when the version archived the figures area; null means
   * "the live project root" (no version, or a version without figures).
   */
  figureBase: string | null
  /**
   * The live manuscript dir, kept as a fallback for a markdown image the
   * archived version does not carry (a version logged before that image
   * existed under an archived area). Equal to contentDir for a live export.
   */
  liveManuscriptDir: string
}

/**
 * Resolve where an export reads from: the working copy when `versionId` is
 * omitted, else the ARCHIVED copy under `<manuscript dir>/archive/<id>/`
 * (version-log.ts). Archive layouts differ by LoggedVersion.schemaVersion:
 * v2 records areas (`archive/<id>/manuscript/...`, `archive/<id>/figures/...`),
 * v1 records manuscript files version-relative (`archive/<id>/manuscript.md`).
 * The index record decides; a version missing from the index is sniffed by
 * layout so a hand-copied archive folder still exports. Throws, naming the
 * version, when the archive directory does not exist.
 */
export async function resolveExportSource(root: string, versionId?: string): Promise<ExportSource> {
  const live = await projectSubdir(assertInsideAllowedRoot(root), 'manuscript')
  if (versionId === undefined) {
    return { contentDir: live, figureBase: null, liveManuscriptDir: live }
  }
  const versionRoot = join(live, 'archive', versionId)
  const info = await stat(versionRoot).catch(() => null)
  if (info === null || !info.isDirectory()) {
    throw new Error(
      `logged version "${versionId}" has no archive — expected ${versionRoot}. ` +
        `Log the version before exporting it, or export the working copy instead.`
    )
  }
  const record = (await readVersionArchive(root)).versions.find((v) => v.id === versionId)
  const areaLayout =
    record !== undefined ? record.schemaVersion === 2 : existsSync(join(versionRoot, 'manuscript'))
  const contentDir = areaLayout ? join(versionRoot, 'manuscript') : versionRoot
  const hasFigures =
    record !== undefined ? record.areas.includes('figures') : existsSync(join(versionRoot, 'figures'))
  return { contentDir, figureBase: hasFigures ? versionRoot : null, liveManuscriptDir: live }
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
  /** The byline, from manuscript/authors.json (ARCHITECTURE §4.3) — empty when the file doesn't exist yet. */
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
  /**
   * Live manuscript dir to fall back to for a markdown image an archived
   * version does not carry — null for a live (non-versioned) export, where
   * `manuscriptDir` IS the live dir. See resolveExportImagePath.
   */
  imageFallbackDir: string | null
}

/** One rendered back-matter section: an H1 title plus its body paragraphs. */
export interface BackMatterSection {
  title: string
  paragraphs: string[]
}

/**
 * The back-matter sections that actually have content, in the ground-truth
 * (docx-tools) order: Acknowledgments → Funding → Competing Interests →
 * Data/Code Availability → Author Contributions. Shared by the DOCX and
 * HTML/PDF writers so the two render the same sections in the same order.
 * Funding entries join into one "Funder (grant)" paragraph; the availability
 * statements merge into one section when both are present and keep their own
 * heading when only one is. `peerReview` and `supplementaryInfo` are
 * submission-system metadata with no stated place in the manuscript body —
 * deliberately not exported.
 */
export function backMatterSections(content: ExportContent): BackMatterSection[] {
  const m = content.manuscript
  const bm = m.backMatter
  const out: BackMatterSection[] = []
  const hasText = (s: string | null): s is string => s !== null && s.trim() !== ''

  if (hasText(bm.acknowledgements)) out.push({ title: 'Acknowledgments', paragraphs: [bm.acknowledgements] })
  if (bm.funding.length > 0) {
    out.push({
      title: 'Funding',
      paragraphs: [bm.funding.map((f) => (f.grant !== null ? `${f.funder} (${f.grant})` : f.funder)).join('; ')]
    })
  }
  if (hasText(bm.competingInterests)) out.push({ title: 'Competing Interests', paragraphs: [bm.competingInterests] })

  const data = m.availability.data.trim()
  const code = m.availability.code.trim()
  if (data !== '' && code !== '') out.push({ title: 'Data and Code Availability', paragraphs: [data, code] })
  else if (data !== '') out.push({ title: 'Data Availability', paragraphs: [data] })
  else if (code !== '') out.push({ title: 'Code Availability', paragraphs: [code] })

  if (hasText(bm.authorContributions)) out.push({ title: 'Author Contributions', paragraphs: [bm.authorContributions] })
  return out
}

export interface BuildExportContentOptions {
  dir: string
  profileId: string
  /** figureId -> absolute path to an already-rasterized PNG. */
  figurePngPaths: Readonly<Record<string, string>>
  /** Export this LOGGED version instead of the working copy (resolveExportSource). */
  versionId?: string
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

  const source = await resolveExportSource(root, opts.versionId)
  const manuscriptDir = source.contentDir
  const manuscript = ManuscriptSchema.parse(
    opts.versionId === undefined
      ? await readManuscript(root)
      : (JSON.parse(
          await readFile(assertInsideAllowedRoot(join(manuscriptDir, 'manuscript.json')), 'utf8')
        ) as unknown)
  )
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

  // Numbering follows the prose: first-embed order wins, manifest order only
  // for anything never embedded.
  const figureEmbedOrder = sections.flatMap((s) => (s.root === null ? [] : collectFigureEmbeds(s.root)))
  const tableEmbedOrder = sections.flatMap((s) => (s.root === null ? [] : collectTableEmbeds(s.root)))
  const orderedFigures = orderByEmbedAppearance(manuscript.figures, figureEmbedOrder)
  const orderedTables = orderByEmbedAppearance(manuscript.tables, tableEmbedOrder)

  const labels = buildLabelMap(
    orderedFigures,
    orderedTables,
    sections.map((s) => ({ heading: s.heading, source: s.source })),
    { figure: resolveDocumentStyle(profile).figureLabel, table: 'Table' }
  )

  const figures: ExportFigureContent[] = orderedFigures.map((figure) => {
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

  const tables: ExportTableContent[] = orderedTables.map((table) => ({
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
    referenceCount: referenceRows.length,
    imageFallbackDir: opts.versionId === undefined ? null : source.liveManuscriptDir
  }
}

/* ------------------------------------------------------------------ */
/* Supplementary Information                                            */
/* ------------------------------------------------------------------ */

/** The optional supplement source, by convention beside manuscript.md. */
export const SUPPLEMENT_FILE = 'supplementary.md'

interface EmbedWalkNode {
  type?: unknown
  figureId?: unknown
  tableId?: unknown
  children?: unknown
}

function walkEmbeds(node: EmbedWalkNode, kind: 'figureEmbed' | 'tableEmbed', out: string[]): void {
  if (node.type === kind) {
    const id = kind === 'figureEmbed' ? node.figureId : node.tableId
    if (typeof id === 'string') out.push(id)
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkEmbeds(child as EmbedWalkNode, kind, out)
  }
}

/** Every `![[fig:id]]` embed in one section's AST, in document order. */
export function collectFigureEmbeds(root: SciMarkRoot): string[] {
  const out: string[] = []
  walkEmbeds(root as unknown as EmbedWalkNode, 'figureEmbed', out)
  return out
}

/** Every `![[tbl:id]]` embed in one section's AST, in document order. */
export function collectTableEmbeds(root: SciMarkRoot): string[] {
  const out: string[] = []
  walkEmbeds(root as unknown as EmbedWalkNode, 'tableEmbed', out)
  return out
}

/**
 * The manuscript's figures/tables reordered by first embed appearance in the
 * prose — the order that drives numbering (RULE: numbering is derived at
 * format time, never stored). Items the prose never embeds keep their
 * manifest order, after the embedded ones.
 */
export function orderByEmbedAppearance<T extends Identified>(
  items: readonly T[],
  embedOrder: readonly string[]
): T[] {
  const rank = new Map<string, number>()
  embedOrder.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i)
  })
  return [...items].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
    return ra === rb ? 0 : ra - rb
  })
}

/**
 * The Supplementary Information content model — a SIBLING of
 * `buildExportContent` rather than a mode flag on it, because almost every
 * derived value is scoped differently: sections come from
 * manuscript/supplementary.md, citations are numbered independently by first
 * appearance IN the supplement (restarting at [1], resolved against the same
 * references.bib), figures are only the ones the supplement embeds and are
 * S-labelled by their order of appearance there, and no manuscript.json
 * figure/table is required to exist in it. Threading all of that through the
 * main builder as conditionals would obscure both paths; sharing the small
 * pure helpers keeps the two in lockstep instead.
 *
 * The returned model is `ExportContent`-shaped so the writers' shared
 * machinery (citation runs, cross-refs, reference formatting, list walking)
 * works unchanged. Supplement-specific readings of it:
 * - `labels.figures` maps embedded figure ids to "Figure S<n>".
 * - `figures` lists only the embedded figures, in supplement order.
 * - `tables` is EMPTY: a supplement table is a GFM table physically in the
 *   prose, captioned "Table S<n>." positionally by the writers
 *   (manuscript.json's captioned tables belong to the main manuscript, and
 *   labelling them with main-numbering inside a supplement would mislead).
 *
 * Throws a clear error naming the expected path when supplementary.md does
 * not exist — the caller surfaces it verbatim.
 */
export async function buildSupplementContent(opts: BuildExportContentOptions): Promise<ExportContent> {
  const root = assertInsideAllowedRoot(opts.dir)
  const profile = getBundledProfile(opts.profileId)
  if (profile === null) {
    throw new Error(`unknown publisher profile "${opts.profileId}"`)
  }

  const source = await resolveExportSource(root, opts.versionId)
  const manuscriptDir = source.contentDir
  const manuscript = ManuscriptSchema.parse(
    opts.versionId === undefined
      ? await readManuscript(root)
      : (JSON.parse(
          await readFile(assertInsideAllowedRoot(join(manuscriptDir, 'manuscript.json')), 'utf8')
        ) as unknown)
  )
  const authors = await readAuthorsFile(manuscriptDir)

  const suppPath = join(manuscriptDir, SUPPLEMENT_FILE)
  let md: string
  try {
    md = await readFile(assertInsideAllowedRoot(suppPath), 'utf8')
  } catch {
    throw new Error(
      `no supplementary manuscript found — expected ${suppPath}. ` +
        `Create manuscript/${SUPPLEMENT_FILE} to export a Supplementary Information document.`
    )
  }

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

  // Independent citation numbering: clusters collected from the SUPPLEMENT
  // only, so its first citation is [1] whatever the main manuscript numbers.
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

  // S-labels: figures numbered by order of first appearance in the supplement.
  const embeddedIds: string[] = []
  for (const section of sections) {
    if (section.root === null) continue
    for (const id of collectFigureEmbeds(section.root)) {
      if (!embeddedIds.includes(id)) embeddedIds.push(id)
    }
  }
  const figures: ExportFigureContent[] = embeddedIds.map((id, i) => {
    const figure = manuscript.figures.find((f) => f.id === id)
    if (figure === undefined) {
      throw new Error(`supplementary.md embeds unknown figure "${id}" — it is not in manuscript.json`)
    }
    const pngPath = opts.figurePngPaths[id]
    if (pngPath === undefined) {
      throw new Error(
        `no rasterized PNG supplied for supplement figure "${id}" — rasterize every embedded figure ` +
          `(figure:export 'png' + figure:write-binary) before calling export:docx/export:pdf`
      )
    }
    return { figure, label: `Figure S${i + 1}`, pngPath: assertInsideAllowedRoot(pngPath) }
  })

  // Equation/section labels derive from the supplement's own prose; figure
  // cross-refs resolve to the S-labels; @tbl: refs have no supplement target
  // (GFM tables carry no ids) and keep the literal fallback.
  const derived = buildLabelMap(
    [],
    [],
    sections.map((s) => ({ heading: s.heading, source: s.source }))
  )
  const labels: LabelMap = {
    figures: new Map(figures.map((f) => [f.figure.id, f.label])),
    tables: new Map(),
    equations: derived.equations,
    sections: derived.sections
  }

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
    tables: [],
    referenceCount: referenceRows.length,
    imageFallbackDir: opts.versionId === undefined ? null : source.liveManuscriptDir
  }
}

/* ------------------------------------------------------------------ */
/* The shared manuscript-export prologue                                */
/* ------------------------------------------------------------------ */

/** The request fields every manuscript-export channel shares (docx/html/pdf/preview). */
export interface ManuscriptExportBaseRequest {
  dir: string
  profileId: string
  figurePngPaths: Readonly<Record<string, string>>
  /** Export a LOGGED version instead of the working copy. */
  versionId?: string
  /** 'manuscript' (default) or the Supplementary Information document. */
  target?: 'manuscript' | 'supplement'
}

export interface PreparedManuscriptExport {
  root: string
  supplement: boolean
  content: ExportContent
}

/**
 * The identical prologue of exportDocx/exportPdf/exportHtml/exportPreview,
 * once: root check, supplement flag, version-aware content build.
 * buildSupplementContent throws a clear error naming the expected
 * manuscript/supplementary.md path when the project has none;
 * resolveExportSource throws naming the version when its archive is missing.
 */
export async function prepareManuscriptExport(
  req: ManuscriptExportBaseRequest
): Promise<PreparedManuscriptExport> {
  const root = assertInsideAllowedRoot(req.dir)
  const supplement = req.target === 'supplement'
  const buildOpts: BuildExportContentOptions = {
    dir: root,
    profileId: req.profileId,
    figurePngPaths: req.figurePngPaths,
    versionId: req.versionId
  }
  const content = supplement ? await buildSupplementContent(buildOpts) : await buildExportContent(buildOpts)
  return { root, supplement, content }
}

/** `<root>/output/<name>.<ext>` — where every manuscript export lands. */
export async function exportOutputPath(root: string, outputName: string, ext: string): Promise<string> {
  return join(await projectSubdir(root, 'output'), `${outputName}.${ext}`)
}
