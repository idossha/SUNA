/**
 * DOCX import orchestrator (feature-plan-6 §2) — the only impure file in the
 * import pipeline. `analyzeDocx` runs mammoth + the pure heuristics in
 * docx-html.ts/docx-heuristics.ts/docx-references.ts and returns a
 * `DocxAnalysis` WITHOUT writing anything to the target project; `commitDocxAnalysis`
 * is the one function that writes.
 */

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import mammoth from 'mammoth'
import JSZip from 'jszip'
import type { Author as BibAuthor, BibEntry } from '@suna/bib'
import { serializeBibtex } from '@suna/bib'
import {
  AuthorsFileSchema,
  DEFAULT_PROJECT_DIRS,
  DocxAnalysisSchema,
  ManuscriptSchema,
  SunaProjectManifestSchema,
  type Affiliation as ManuscriptAffiliation,
  type Author as ManuscriptAuthor,
  type AuthorsFile,
  type DocxAnalysis,
  type DocxAuthorDraft,
  type DocxFigureDraft,
  type DocxSectionDraft,
  type DocxWarning,
  type Manuscript,
  type SunaProjectManifest
} from '@suna/core'
import { parseHtmlBlocks } from './docx-html'
import {
  blocksToMarkdown,
  detectAbstract,
  detectAffiliations,
  detectAuthors,
  detectTitle,
  splitSections
} from './docx-heuristics'
import { extractReferences, rewriteBlocksCitations, type DocxReferenceDraftLike } from './docx-references'
import { writeFileAtomic } from './atomic'
import { allowRoot } from './roots'

const run = promisify(execFile)

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for unit tests)                               */
/* ------------------------------------------------------------------ */

/**
 * Word equations are OOXML `<m:oMath>` elements mammoth does not convert
 * (spec §2.3: "attempt only if you can do it reliably; otherwise keep the
 * text and add a warning — a broken \( \) is worse than a flagged
 * paragraph"). Rather than guess which output paragraph lost math, this
 * counts them straight from the raw part XML and surfaces one honest,
 * document-level warning.
 */
export function countOmmlEquations(documentXml: string): number {
  const matches = documentXml.match(/<m:oMath[ >]/g)
  return matches === null ? 0 : matches.length
}

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/x-emf': 'emf',
  'image/x-wmf': 'wmf'
}

export function extensionForContentType(contentType: string): string {
  return CONTENT_TYPE_EXT[contentType.toLowerCase()] ?? 'png'
}

/** Our reference author strings are family-first ("Smith, J." / "Smith AB"). */
export function toBibAuthor(raw: string): BibAuthor {
  const comma = raw.indexOf(',')
  if (comma !== -1) {
    const family = raw.slice(0, comma).trim()
    const given = raw.slice(comma + 1).trim()
    if (family === '') return { kind: 'literal', literal: raw.trim() }
    return given === '' ? { kind: 'person', family } : { kind: 'person', family, given }
  }
  const parts = raw.trim().split(/\s+/).filter((p) => p !== '')
  const family = parts[0]
  if (family === undefined) return { kind: 'literal', literal: raw.trim() }
  const given = parts.slice(1).join(' ')
  return given === '' ? { kind: 'person', family } : { kind: 'person', family, given }
}

/** Truncated fallback title for a reference whose body defied parsing —
 *  BibEntry.title is required, and losing the reference entirely would be
 *  worse than a slightly odd title (the full text stays in `note`). */
function bibTitleFallback(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 117)}…`
}

export function referenceToBibEntry(ref: DocxReferenceDraftLike): BibEntry {
  const entry: BibEntry = {
    key: ref.citeKey,
    entryType: 'article',
    title: ref.title ?? bibTitleFallback(ref.raw),
    authors: ref.authors.map(toBibAuthor),
    raw: {}
  }
  if (ref.year !== null) entry.year = ref.year
  if (ref.journal !== null) entry.journal = ref.journal
  if (ref.style === 'unknown' || ref.title === null) entry.note = ref.raw
  return entry
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function dirIsEmpty(dir: string): Promise<boolean> {
  if (!(await pathExists(dir))) return true
  const entries = await readdir(dir)
  return entries.length === 0
}

/* ------------------------------------------------------------------ */
/* analyze()                                                            */
/* ------------------------------------------------------------------ */

/** mammoth's default style map already sends "Heading 1..6" to h1..h6 and
 *  direct bold/italic/superscript/subscript formatting to strong/em/sup/sub —
 *  this makes the paragraph-style mapping explicit anyway (spec §2.1), and
 *  covers a couple of common non-default styles mammoth leaves untouched. */
const STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Title'] => p:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  'b => strong',
  'i => em'
]

async function extractDocument(
  docxPath: string,
  tempDir: string
): Promise<{ html: string; figures: DocxFigureDraft[]; warnings: DocxWarning[] }> {
  const warnings: DocxWarning[] = []
  let counter = 0
  const figures: DocxFigureDraft[] = []

  const convertImage = mammoth.images.imgElement(async (image) => {
    counter += 1
    const id = `imported-${counter}`
    const ext = extensionForContentType(image.contentType)
    const buffer = await image.read()
    await mkdir(tempDir, { recursive: true })
    const tempPath = join(tempDir, `${id}.${ext}`)
    await writeFile(tempPath, buffer)
    figures.push({ id, tempPath, ext, alt: '' })
    // A placeholder token, never a data URI or a raw temp path — commit()
    // rewrites it to the final figures/<id>/figure.<ext> relative path.
    return { src: `docx-image:${id}` }
  })

  const result = await mammoth.convertToHtml({ path: docxPath }, { styleMap: STYLE_MAP, convertImage })
  for (const message of result.messages) {
    if (message.type === 'error') {
      warnings.push({ code: 'mammoth-error', message: message.message, context: null })
    }
  }

  try {
    const buffer = await readFile(docxPath)
    const zip = await JSZip.loadAsync(buffer)
    const documentXmlFile = zip.file('word/document.xml')
    const documentXml = documentXmlFile !== null ? await documentXmlFile.async('text') : ''
    const equationCount = countOmmlEquations(documentXml)
    if (equationCount > 0) {
      warnings.push({
        code: 'omml-equations',
        message: `${equationCount} Word equation${equationCount === 1 ? '' : 's'} (OOXML OMML) detected — mammoth does not convert these reliably, so the surrounding text was kept as-is rather than emitting broken math. Review equations manually.`,
        context: null
      })
    }
  } catch (error) {
    warnings.push({
      code: 'omml-scan-failed',
      message: `Could not scan the source .docx for embedded equations: ${error instanceof Error ? error.message : String(error)}`,
      context: null
    })
  }

  return { html: result.value, figures, warnings }
}

/** Indices consumed by front-matter detection — excluded from body sections. */
function frontMatterExcludedIndices(
  title: { index: number | null },
  authors: { index: number | null },
  affiliations: { usedIndices: number[] },
  abstract: { index: number | null; headingIndex: number | null }
): Set<number> {
  const excluded = new Set<number>()
  if (title.index !== null) excluded.add(title.index)
  if (authors.index !== null) excluded.add(authors.index)
  for (const i of affiliations.usedIndices) excluded.add(i)
  if (abstract.index !== null) excluded.add(abstract.index)
  if (abstract.headingIndex !== null) excluded.add(abstract.headingIndex)
  return excluded
}

export async function analyzeDocx(docxPath: string): Promise<DocxAnalysis> {
  const tempDir = join(tmpdir(), `suna-docx-import-${randomBytes(6).toString('hex')}`)
  const { html, figures, warnings } = await extractDocument(docxPath, tempDir)
  const blocks = parseHtmlBlocks(html)

  const title = detectTitle(blocks)
  const authors = detectAuthors(blocks, title.index ?? -1)
  const affiliations = detectAffiliations(blocks, authors.index ?? title.index ?? -1)
  const abstract = detectAbstract(blocks)
  const excluded = frontMatterExcludedIndices(title, authors, affiliations, abstract)

  const { headingIndex: refHeadingIndex, references } = extractReferences(blocks)
  const bodyEnd = refHeadingIndex ?? blocks.length
  const bodyBlocks = blocks.slice(0, bodyEnd)

  const { blocks: rewrittenBody, mappedCount, literalCount, warnings: citationWarnings } = rewriteBlocksCitations(
    bodyBlocks,
    references
  )

  const sectionDrafts = splitSections(rewrittenBody, 0, excluded)
  const sections = sectionDrafts.map((s) => ({
    heading: s.heading,
    level: s.level,
    markdown: blocksToMarkdown(s.blocks)
  }))

  if (title.index === null) {
    warnings.push({ code: 'title-not-found', message: title.reason, context: null })
  }
  if (authors.authors.length === 0) {
    warnings.push({ code: 'authors-not-found', message: authors.reason, context: null })
  }
  if (abstract.value === null) {
    warnings.push({ code: 'abstract-not-found', message: abstract.reason, context: null })
  }
  if (refHeadingIndex === null) {
    warnings.push({
      code: 'references-not-found',
      message: 'No heading matching /references|bibliography|works cited/i was found — no references.bib entries were generated.',
      context: null
    })
  }

  const affiliationMarkers = new Set(affiliations.affiliations.map((a) => a.marker))
  const authorDrafts: DocxAuthorDraft[] = authors.authors.map((a) => {
    const refs = a.markers.filter((m) => affiliationMarkers.has(m))
    if (refs.length < a.markers.length) {
      warnings.push({
        code: 'affiliation-marker-unresolved',
        message: `Author "${a.name}" has a marker with no matching affiliation paragraph.`,
        context: a.markers.join(',')
      })
    }
    return { name: a.name, given: a.given, family: a.family, markers: a.markers, affiliationRefs: refs }
  })

  const analysis: DocxAnalysis = {
    sourcePath: docxPath,
    tempDir: figures.length > 0 ? tempDir : null,
    title: { value: title.value, reason: title.reason },
    authors: authorDrafts,
    authorsReason: authors.reason,
    affiliations: affiliations.affiliations,
    affiliationsReason: affiliations.reason,
    abstract: { value: abstract.value, reason: abstract.reason },
    sections,
    references,
    citationReport: { mappedCount, literalCount },
    figures,
    warnings: [...warnings, ...citationWarnings]
  }
  return DocxAnalysisSchema.parse(analysis)
}

/* ------------------------------------------------------------------ */
/* commit()                                                             */
/* ------------------------------------------------------------------ */

const PROJECT_GITIGNORE = `output/
.DS_Store
__pycache__/
.venv/
`

function requireComplete(analysis: DocxAnalysis): void {
  const problems: string[] = []
  if (analysis.title.value === null || analysis.title.value.trim() === '') problems.push('title')
  if (analysis.authors.length === 0) problems.push('authors')
  if (analysis.abstract.value === null || analysis.abstract.value.trim() === '') problems.push('abstract')
  if (analysis.sections.length === 0) problems.push('sections')
  if (problems.length > 0) {
    throw new Error(
      `Cannot import: fill in the following in the review screen before committing — ${problems.join(', ')}.`
    )
  }
}

/** figures/<id>/figure.<ext> relative to manuscript/manuscript.md (feature-plan-7 §1: one flat prose file). */
function figureRelativePath(id: string, ext: string): string {
  return `../figures/${id}/figure.${ext}`
}

function rewriteImagePlaceholders(markdown: string, figures: readonly DocxFigureDraft[]): string {
  const byId = new Map(figures.map((f) => [f.id, f.ext]))
  return markdown.replace(/docx-image:([a-zA-Z0-9_-]+)/g, (match, id: string) => {
    const ext = byId.get(id)
    return ext === undefined ? match : figureRelativePath(id, ext)
  })
}

/**
 * Appends a block, guaranteeing exactly one blank line between blocks —
 * mirrors migrate-manuscript.ts's own `appendBlock` (duplicated rather than
 * imported: that module's helper is not exported, and the two call sites
 * have no other reason to share a module).
 */
function appendBlock(accumulated: string, block: string): string {
  if (block === '') return accumulated
  if (accumulated === '') return block
  return `${accumulated.replace(/\s*$/, '')}\n\n${block}`
}

/**
 * Joins the analyzer's section drafts into ONE manuscript.md: each section's
 * heading rendered at its Word heading depth (`level` 1 → `#`, 2 → `##`),
 * followed by its already-parsed Markdown body with image placeholders
 * resolved to their final `figures/<id>/figure.<ext>` path. A section with
 * `heading: null` (there is at most one — the untitled lead before the first
 * real heading) contributes prose only.
 */
export function buildManuscriptMarkdown(
  sections: readonly DocxSectionDraft[],
  figures: readonly DocxFigureDraft[]
): string {
  let markdown = ''
  for (const section of sections) {
    if (section.heading !== null) {
      markdown = appendBlock(markdown, `${'#'.repeat(section.level)} ${section.heading}`)
    }
    const body = rewriteImagePlaceholders(section.markdown, figures)
    if (body.trim() !== '') markdown = appendBlock(markdown, body)
  }
  return markdown === '' ? '' : `${markdown.replace(/\s*$/, '')}\n`
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+[\w]/

/**
 * A correspondence line is NOT an affiliation. Real manuscripts append a
 * marked entry like "*Corresponding author: gtononi@wisc.edu" to the
 * affiliation block, and the affiliation heuristic — which only looks for "a
 * short marked paragraph" — cannot tell the two apart. Treating it as an
 * affiliation is wrong twice over: it invents an institution nobody belongs
 * to, and it throws away the `corresponding`/`email` fields the manuscript
 * schema has for exactly this.
 *
 * An entry is correspondence when it says so, or when a NON-numeric marker
 * (`*`, `†`) carries an email — numeric markers stay affiliations even if an
 * institution lists a contact address.
 */
export function isCorrespondenceEntry(entry: { marker: string; text: string }): boolean {
  if (/correspond/i.test(entry.text)) return true
  return !/^\d+$/.test(entry.marker) && EMAIL_RE.test(entry.text)
}

export interface DerivedCorrespondence {
  /** Affiliation drafts with correspondence lines removed. */
  affiliations: readonly { marker: string; text: string }[]
  /** Markers that denote correspondence rather than an institution. */
  markers: ReadonlySet<string>
  /** Email parsed out of the correspondence line, if it stated one. */
  email: string | null
}

/**
 * Splits correspondence lines out of the detected affiliation list and
 * recovers the contact email from them.
 */
export function deriveCorrespondence(
  affiliations: readonly { marker: string; text: string }[]
): DerivedCorrespondence {
  const markers = new Set<string>()
  let email: string | null = null
  const kept: { marker: string; text: string }[] = []
  for (const entry of affiliations) {
    if (!isCorrespondenceEntry(entry)) {
      kept.push(entry)
      continue
    }
    markers.add(entry.marker)
    if (email === null) email = EMAIL_RE.exec(entry.text)?.[0] ?? null
  }
  return { affiliations: kept, markers, email }
}

interface BuiltManuscript {
  manuscript: Manuscript
  authorsFile: AuthorsFile
}

/**
 * Builds manuscript.json's metadata (no prose, no byline — feature-plan-7
 * §1) and authors.json's byline together, since both derive from the same
 * correspondence-line split.
 */
function buildManuscriptAndAuthors(analysis: DocxAnalysis): BuiltManuscript {
  const title = analysis.title.value as string // requireComplete() already guaranteed this
  const correspondence = deriveCorrespondence(analysis.affiliations)
  const affiliations: ManuscriptAffiliation[] = correspondence.affiliations.map((a, i) => ({
    id: `af${i + 1}`,
    text: a.text
  }))
  const markerToAfId = new Map(correspondence.affiliations.map((a, i) => [a.marker, `af${i + 1}`]))

  /**
   * Who is corresponding: whoever carries a correspondence marker. Falling
   * back to the first author when the document marks nobody is a convention,
   * not a fact the document stated — but `corresponding` is a required
   * boolean, and the review screen lets the user correct it.
   */
  const markedCorresponding = analysis.authors.map((a) =>
    a.markers.some((m) => correspondence.markers.has(m))
  )
  const anyMarked = markedCorresponding.some(Boolean)

  const authors: ManuscriptAuthor[] = analysis.authors.map((a, i) => {
    const corresponding = anyMarked ? (markedCorresponding[i] as boolean) : i === 0
    return {
      id: `a${i + 1}`,
      given: a.given,
      family: a.family,
      nativeScript: null,
      orcid: null,
      affiliationRefs: a.affiliationRefs
        .map((marker) => markerToAfId.get(marker))
        .filter((id): id is string => id !== undefined),
      corresponding,
      // only attach the parsed address to an author the document actually marked
      email: corresponding && anyMarked ? correspondence.email : null,
      equalContribution: false,
      deceased: false
    }
  })

  const manuscript = ManuscriptSchema.parse({
    title,
    shortTitle: title,
    articleType: 'article',
    doi: null,
    openAccess: null,
    history: { received: null, accepted: null, publishedOnline: null },
    abstract: { content: analysis.abstract.value as string },
    manuscriptFile: 'manuscript.md',
    figures: [],
    tables: [],
    availability: { data: '', code: '' },
    backMatter: {
      acknowledgements: null,
      authorContributions: null,
      funding: [],
      competingInterests: null,
      peerReview: null,
      supplementaryInfo: null
    },
    bibliography: 'references.bib'
  } satisfies Manuscript)

  const authorsFile = AuthorsFileSchema.parse({ schemaVersion: 1, authors, affiliations } satisfies AuthorsFile)

  return { manuscript, authorsFile }
}

export async function commitDocxAnalysis(
  analysis: DocxAnalysis,
  targetDir: string,
  force: boolean
): Promise<{ dir: string }> {
  requireComplete(analysis)

  // Import must NEVER overwrite an existing SUNA project — this check is
  // unconditional, `force` only ever relaxes "the folder has other stuff in
  // it", never "the folder is already someone's project".
  if (await pathExists(join(targetDir, 'suna.json'))) {
    throw new Error(`refusing to import into an existing SUNA project: ${targetDir}`)
  }
  if (!force && !(await dirIsEmpty(targetDir))) {
    throw new Error(`target directory is not empty (pass force to import anyway): ${targetDir}`)
  }

  const { manuscript, authorsFile } = buildManuscriptAndAuthors(analysis)
  const manuscriptMarkdown = buildManuscriptMarkdown(analysis.sections, analysis.figures)

  await mkdir(targetDir, { recursive: true })
  for (const sub of Object.values(DEFAULT_PROJECT_DIRS)) {
    await mkdir(join(targetDir, sub), { recursive: true })
  }
  const manuscriptDir = join(targetDir, DEFAULT_PROJECT_DIRS.manuscript)
  await mkdir(manuscriptDir, { recursive: true })

  const name = basename(targetDir)
  const manifest: SunaProjectManifest = SunaProjectManifestSchema.parse({
    schemaVersion: 1,
    name,
    // House style, like every other new project: importing a .docx says
    // nothing about where it is going. The author picks a journal when
    // there is one to pick.
    activeProfileId: 'suna',
    directories: DEFAULT_PROJECT_DIRS,
    createdAt: new Date().toISOString()
  })
  await writeFile(join(targetDir, 'suna.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(join(manuscriptDir, 'manuscript.json'), JSON.stringify(manuscript, null, 2) + '\n')
  await writeFile(join(manuscriptDir, 'authors.json'), JSON.stringify(authorsFile, null, 2) + '\n')
  await writeFileAtomic(join(manuscriptDir, manuscript.manuscriptFile), manuscriptMarkdown)

  const bibEntries = analysis.references.map(referenceToBibEntry)
  await writeFileAtomic(join(manuscriptDir, 'references.bib'), bibEntries.length > 0 ? serializeBibtex(bibEntries) : '')

  const figuresRoot = join(targetDir, DEFAULT_PROJECT_DIRS.figures)
  for (const figure of analysis.figures) {
    const dest = join(figuresRoot, figure.id, `figure.${figure.ext}`)
    await mkdir(join(figuresRoot, figure.id), { recursive: true })
    await copyFile(figure.tempPath, dest)
  }

  await writeFile(join(targetDir, '.gitignore'), PROJECT_GITIGNORE)

  try {
    await run('git', ['init', '-b', 'main'], { cwd: targetDir })
    await run('git', ['add', '-A'], { cwd: targetDir })
    await run('git', ['commit', '-m', 'Import manuscript from DOCX'], { cwd: targetDir })
  } catch (error) {
    console.warn('git init failed after DOCX import (continuing without VCS):', error)
  }

  if (analysis.tempDir !== null) {
    await rm(analysis.tempDir, { recursive: true, force: true }).catch(() => undefined)
  }

  allowRoot(targetDir)
  return { dir: targetDir }
}
